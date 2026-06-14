namespace EminentAi.Application.Providers;

public sealed record ProviderHealth(
    string ProviderName,
    bool IsHealthy,
    string? ErrorMessage,
    DateTime CheckedAt
);
