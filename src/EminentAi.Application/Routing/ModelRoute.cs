using EminentAi.Application.Providers;

namespace EminentAi.Application.Routing;

public sealed record ModelRoute(
    ModelDescriptor Model,
    string ProviderName,
    string SelectionReason,
    bool IsExactMatch
);
