namespace EminentAi.Application.Providers;

/// <summary>
/// Describes a model available from a provider.
/// IsLocal, Region, and cost fields are used by ModelRouterService to enforce
/// CostPolicy and DataResidencyPolicy without reaching into infrastructure.
/// </summary>
public sealed record ModelDescriptor(
    string Name,
    string ProviderName,
    IReadOnlySet<ModelCapability> Capabilities,
    long SizeBytes,
    string Tier,
    bool IsAvailable,
    bool IsLocal,
    string? Region,
    decimal? InputTokenCostUsd,
    decimal? OutputTokenCostUsd
);
