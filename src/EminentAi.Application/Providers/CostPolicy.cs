namespace EminentAi.Application.Providers;

public sealed record CostPolicy(
    bool PreferLocal,
    decimal? MaxCostPerTokenUsd,
    IReadOnlySet<string> BlockedProviders
)
{
    public static readonly CostPolicy DefaultLocal = new(
        PreferLocal: true,
        MaxCostPerTokenUsd: null,
        BlockedProviders: new HashSet<string>()
    );
}
