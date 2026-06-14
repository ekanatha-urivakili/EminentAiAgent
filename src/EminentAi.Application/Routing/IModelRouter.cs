using EminentAi.Application.Agents;
using EminentAi.Application.Providers;

namespace EminentAi.Application.Routing;

public interface IModelRouter
{
    /// <summary>
    /// Resolves the best available model across all registered providers.
    /// Returns null when no eligible model is found (triggers routing_error SSE).
    /// </summary>
    Task<ModelRoute?> ResolveAsync(
        AgentProfile profile,
        CostPolicy costPolicy,
        DataResidencyPolicy residencyPolicy,
        CancellationToken ct = default);
}
