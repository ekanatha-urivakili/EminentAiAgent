using EminentAi.Application.Agents;

namespace EminentAi.Application.Routing;

public sealed record ClassificationRecord(
    string RawLabel,
    bool WasFastPath,
    bool ManualOverrideApplied,
    AgentKind? OverrideRequestedKind,
    string? OverrideRejectedReason
);
