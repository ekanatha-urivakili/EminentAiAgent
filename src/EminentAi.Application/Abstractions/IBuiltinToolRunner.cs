using System.Text.Json.Nodes;

namespace EminentAi.Application.Abstractions;

/// <summary>
/// Built-in local tools (filesystem + shell) so Agent mode works with zero external MCP servers.
/// The runner is sandboxed to a workspace root and the shell enforces a denylist.
/// </summary>
public interface IBuiltinToolRunner
{
    /// <summary>Connector names this runner handles ("filesystem", "shell").</summary>
    bool Handles(string connectorName);

    IReadOnlyList<ToolSchema> GetTools(string connectorName);

    /// <summary>True if the tool mutates state (write/delete/execute) and therefore needs gating.</summary>
    bool IsMutating(string connectorName, string toolName);

    Task<JsonNode> CallAsync(string connectorName, string toolName, JsonNode? args, CancellationToken ct = default);
}

/// <summary>Configuration for the built-in tool sandbox.</summary>
public sealed record BuiltinToolOptions(string? WorkspaceRoot);
