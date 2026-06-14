using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using EminentAi.Application.Abstractions;
using EminentAi.Domain;
using EminentAi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace EminentAi.Infrastructure.Mcp;

/// <summary>
/// MCP connector host. Registered as a singleton so stdio server processes are spawned once
/// and reused across requests. Policy gating happens in the orchestrator, not here —
/// this layer only connects, lists, and calls.
/// </summary>
public sealed class McpHost(IDbContextFactory<EminentAiDbContext> dbFactory) : IMcpHost, IAsyncDisposable
{
    private readonly ConcurrentDictionary<string, Lazy<Task<McpClient>>> _clients = new();

    public async Task<IReadOnlyList<ToolSchema>> GetToolsAsync(string[] connectorNames, CancellationToken ct = default)
    {
        var tasks = connectorNames.Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(name => GetToolsForConnectorAsync(name, ct));

        var results = await Task.WhenAll(tasks);
        return results.SelectMany(r => r).ToList();
    }

    private async Task<IReadOnlyList<ToolSchema>> GetToolsForConnectorAsync(string name, CancellationToken ct)
    {
        try
        {
            var client = await GetOrConnectAsync(name, ct);
            var tools = await client.ListToolsAsync((ModelContextProtocol.RequestOptions?)null, ct);
            return tools.Select(tool => new ToolSchema(
                $"{name}.{tool.Name}",
                tool.Description ?? string.Empty,
                JsonNode.Parse(tool.JsonSchema.GetRawText())!
            )).ToList();
        }
        catch
        {
            return Array.Empty<ToolSchema>();
        }
    }

    public async Task<JsonNode> CallToolAsync(string connectorName, string toolName, JsonNode args, CancellationToken ct = default)
    {
        var client = await GetOrConnectAsync(connectorName, ct);
        var argumentsDict = args.Deserialize<Dictionary<string, object?>>() ?? new Dictionary<string, object?>();

        var result = await client.CallToolAsync(toolName, argumentsDict, null, null, ct);

        var textContent = result.Content.OfType<TextContentBlock>().FirstOrDefault();
        return textContent is not null
            ? JsonValue.Create(textContent.Text)
            : JsonNode.Parse(JsonSerializer.Serialize(result.Content))!;
    }

    private async Task<McpClient> GetOrConnectAsync(string name, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var lazy = _clients.GetOrAdd(name, key =>
                new Lazy<Task<McpClient>>(() => ConnectAsync(key, ct), LazyThreadSafetyMode.ExecutionAndPublication));

            try
            {
                return await lazy.Value;
            }
            catch
            {
                _clients.TryRemove(name, out _);
                if (attempt > 0) throw;
            }
        }
        throw new InvalidOperationException($"Failed to connect to connector '{name}'");
    }

    private async Task<McpClient> ConnectAsync(string name, CancellationToken ct)
    {
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        var config = await db.Connectors
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Name == name, ct)
            ?? throw new InvalidOperationException($"Connector '{name}' not found");

        if (!config.Enabled)
            throw new InvalidOperationException($"Connector '{name}' is disabled");

        IClientTransport transport;
        if (config.Transport == ConnectorTransport.Stdio)
        {
            if (!McpCommandLine.TryParse(config.CommandOrUrl, out var command, out var arguments))
                throw new InvalidOperationException($"Connector '{name}' has an invalid command line");

            transport = new StdioClientTransport(new StdioClientTransportOptions
            {
                Name = name,
                Command = command,
                Arguments = arguments
            });
        }
        else
        {
            throw new NotSupportedException(
                $"Transport '{config.Transport}' is not yet supported. Use a stdio MCP server (e.g. 'npx -y @modelcontextprotocol/server-filesystem <root>').");
        }

        return await McpClient.CreateAsync(transport, cancellationToken: ct);
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var entry in _clients.Values)
        {
            if (!entry.IsValueCreated) continue;
            try
            {
                var client = await entry.Value;
                await client.DisposeAsync();
            }
            catch { /* best effort */ }
        }
        _clients.Clear();
    }
}
