namespace EminentAi.Application.Providers;

public sealed record DataResidencyPolicy(
    bool LocalOnly,
    IReadOnlySet<string> AllowedRegions
)
{
    public static readonly DataResidencyPolicy DefaultLocal = new(
        LocalOnly: true,
        AllowedRegions: new HashSet<string>()
    );
}
