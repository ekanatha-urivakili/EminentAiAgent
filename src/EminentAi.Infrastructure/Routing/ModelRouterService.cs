using EminentAi.Application.Agents;
using EminentAi.Application.Providers;
using EminentAi.Application.Routing;
using Microsoft.Extensions.Logging;

namespace EminentAi.Infrastructure.Routing;

/// <summary>
/// Resolves the best available model across all registered providers.
/// Applies data-residency and cost policies first, then capability filters,
/// then name-priority matching, then tier fallback.
/// </summary>
public sealed class ModelRouterService(
    IEnumerable<IModelProvider> providers,
    ILogger<ModelRouterService> logger) : IModelRouter
{
    // Name-priority patterns per agent kind. Earlier entries win.
    private static readonly IReadOnlyDictionary<AgentKind, string[]> NamePriorities =
        new Dictionary<AgentKind, string[]>
        {
            [AgentKind.Vision]          = ["qwen2.5vl", "vl", "vision", "llava", "moondream"],
            [AgentKind.Coding]          = ["gemma4:12b-8k", "qwen3:8b", "qwen2.5-coder", "coder", "deepseek-coder"],
            [AgentKind.Architecture]    = ["gemma4:12b-8k", "qwen3:8b", "qwen3", "gemma4", "qwen2.5:latest", "qwen2.5"],
            [AgentKind.ImageGeneration] = ["flux2-klein", "flux", "diffusion"],
            [AgentKind.General]         = ["gemma4:12b-8k", "qwen3:8b", "qwen3", "qwen2.5:latest", "qwen2.5", "llama3"],
        };

    public async Task<ModelRoute?> ResolveAsync(
        AgentProfile profile,
        CostPolicy costPolicy,
        DataResidencyPolicy residencyPolicy,
        CancellationToken ct = default)
    {
        // 1. Collect healthy providers
        var healthyProviders = await FilterByHealthAsync(providers.ToList(), ct);
        if (healthyProviders.Count == 0)
        {
            logger.LogWarning("No healthy providers available");
            return null;
        }

        // 2. Collect all candidate descriptors from healthy providers (parallel fetch)
        var modelLists = await Task.WhenAll(
            healthyProviders.Select(async p =>
            {
                var models = await p.ListModelsAsync(ct);
                return (Provider: p, Models: models);
            }));
        var allDescriptors = modelLists
            .SelectMany(r => r.Models.Select(m => (Descriptor: m, r.Provider.Name)))
            .ToList();

        // 3. Apply policy filters
        var policyPassed = FilterByPolicy(allDescriptors, costPolicy, residencyPolicy);
        if (policyPassed.Count == 0)
        {
            logger.LogWarning("No models survived policy filter for kind={Kind}", profile.Kind);
            return null;
        }

        // 4. Apply capability filter
        var capPassed = FilterByCapabilities(policyPassed, profile.RequiredCapabilities);
        if (capPassed.Count == 0)
        {
            logger.LogWarning("No models match required capabilities {Caps} for kind={Kind}",
                string.Join(",", profile.RequiredCapabilities), profile.Kind);
            return null;
        }

        // 5. Name-priority matching
        if (NamePriorities.TryGetValue(profile.Kind, out var patterns))
        {
            for (var i = 0; i < patterns.Length; i++)
            {
                var pattern = patterns[i];
                var match = capPassed.FirstOrDefault(x =>
                    MatchesNamePattern(x.Descriptor.Name, pattern));

                if (match.Descriptor is not null)
                {
                    var isExact = i == 0 && match.Descriptor.Name.Equals(patterns[0], StringComparison.OrdinalIgnoreCase);
                    var reason = isExact
                        ? $"exact name match: {match.Descriptor.Name}"
                        : $"name fallback {i + 1}: {match.Descriptor.Name} (preferred: {patterns[0]})";

                    logger.LogInformation("ModelRouter selected {Model} for {Kind}: {Reason}",
                        match.Descriptor.Name, profile.Kind, reason);

                    return new ModelRoute(match.Descriptor, match.ProviderName, reason, isExact);
                }
            }
        }

        // 6. Tier fallback — pick first available with any tier
        var fallback = capPassed.FirstOrDefault();
        if (fallback.Descriptor is not null)
        {
            var reason = $"tier fallback — no name match found, using {fallback.Descriptor.Name} ({fallback.Descriptor.Tier})";
            logger.LogWarning("ModelRouter tier fallback for {Kind}: {Reason}", profile.Kind, reason);
            return new ModelRoute(fallback.Descriptor, fallback.ProviderName, reason, false);
        }

        return null;
    }

    private static async Task<List<IModelProvider>> FilterByHealthAsync(
        List<IModelProvider> providerList, CancellationToken ct)
    {
        var results = await Task.WhenAll(providerList.Select(async p =>
        {
            var health = await p.CheckHealthAsync(ct);
            return (Provider: p, health.IsHealthy);
        }));
        return results.Where(r => r.IsHealthy).Select(r => r.Provider).ToList();
    }

    private static List<(ModelDescriptor Descriptor, string ProviderName)> FilterByPolicy(
        List<(ModelDescriptor Descriptor, string ProviderName)> candidates,
        CostPolicy cost,
        DataResidencyPolicy residency)
    {
        return candidates.Where(x =>
        {
            var m = x.Descriptor;
            // Residency: reject non-local when LocalOnly required
            if (residency.LocalOnly && !m.IsLocal) return false;
            // Residency: reject wrong region when regions are specified
            if (residency.AllowedRegions.Count > 0 && m.Region is not null
                && !residency.AllowedRegions.Contains(m.Region)) return false;
            // Cost: reject models exceeding per-token cap
            if (cost.MaxCostPerTokenUsd is not null)
            {
                var maxCost = Math.Max(m.InputTokenCostUsd ?? 0m, m.OutputTokenCostUsd ?? 0m);
                if (maxCost > cost.MaxCostPerTokenUsd) return false;
            }
            // Cost: reject blocked providers
            if (cost.BlockedProviders.Contains(m.ProviderName)) return false;
            return true;
        }).ToList();
    }

    /// <summary>
    /// Name pattern matching that avoids false positives.
    /// Exact match is preferred; then we allow substring only when the pattern does not contain
    /// a version tag (no colon), guarding against "qwen2.5" matching "qwen2.5vl:latest".
    /// </summary>
    private static bool MatchesNamePattern(string modelName, string pattern)
    {
        // Exact match always wins
        if (modelName.Equals(pattern, StringComparison.OrdinalIgnoreCase)) return true;

        // If pattern includes a version tag (e.g. "qwen2.5:latest"), only exact match
        if (pattern.Contains(':')) return false;

        // Substring match only when the pattern is a short keyword (no colon)
        // and we verify the character after the match is non-alphanumeric to avoid
        // "qwen2.5" matching "qwen2.5vl"
        var idx = modelName.IndexOf(pattern, StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return false;
        var afterIdx = idx + pattern.Length;
        if (afterIdx >= modelName.Length) return true;  // pattern at end of name
        var nextChar = modelName[afterIdx];
        // Boundary: next char must be ':', '-', '.', or end — not a letter/digit continuing the word
        return nextChar is ':' or '-' or '.' or '_';
    }

    private static List<(ModelDescriptor Descriptor, string ProviderName)> FilterByCapabilities(
        List<(ModelDescriptor Descriptor, string ProviderName)> candidates,
        IReadOnlySet<ModelCapability> required)
    {
        if (required.Count == 0) return candidates;
        return candidates.Where(x => required.IsSubsetOf(x.Descriptor.Capabilities)).ToList();
    }
}
