using System.Collections.Generic;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace EminentAi.Application.Abstractions;

public interface IMcpHost
{
    Task<IReadOnlyList<ToolSchema>> GetToolsAsync(string[] connectorNames, CancellationToken ct = default);
    Task<JsonNode> CallToolAsync(string connectorName, string toolName, JsonNode args, CancellationToken ct = default);
}
