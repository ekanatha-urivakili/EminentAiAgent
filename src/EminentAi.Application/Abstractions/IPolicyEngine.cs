using System.Text.Json.Nodes;

namespace EminentAi.Application.Abstractions;

public enum PolicyVerdict
{
    Allow,
    Ask,
    Deny
}

public interface IPolicyEngine
{
    PolicyVerdict Evaluate(string connectorName, string toolName, JsonNode? args);

    /// <summary>Persists a "remember this decision" rule scoped to one connector + tool.</summary>
    Task RememberAsync(string connectorName, string toolName, bool allow, CancellationToken ct = default);
}
