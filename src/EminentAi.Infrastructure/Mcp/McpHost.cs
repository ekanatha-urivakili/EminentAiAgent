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
        var allTools = new List<ToolSchema>();
        foreach (var name in connectorNames)
        {
            var client = await GetOrConnectAsync(name, ct);
            var tools = await client.ListToolsAsync((ModelContextProtocol.RequestOptions?)null, ct);
            foreach (var tool in tools)
            {
                // Namespace tools to avoid collisions: "jira.create_issue"
                allTools.Add(new ToolSchema(
                    $"{name}.{tool.Name}",
                    tool.Description ?? string.Empty,
                    JsonNode.Parse(tool.JsonSchema.GetRawText())!
                ));
            }
        }
        return allTools;
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

    private Task<McpClient> GetOrConnectAsync(string name, CancellationToken ct)
    {
        // Lazy ensures concurrent callers share a single connect attempt per connector.
        var lazy = _clients.GetOrAdd(name, key =>
            new Lazy<Task<McpClient>>(() => ConnectAsync(key, ct), LazyThreadSafetyMode.ExecutionAndPublication));

        if (lazy.IsValueCreated && lazy.Value.IsFaulted)
        {
            _clients.TryRemove(name, out _); // allow reconnect after a failed attempt
            return GetOrConnectAsync(name, ct);
        }
        return lazy.Value;
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
            var parts = config.CommandOrUrl.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            transport = new StdioClientTransport(new StdioClientTransportOptions
            {
                Name = name,
                Command = parts[0],
                Arguments = parts.Skip(1).ToArray()
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
