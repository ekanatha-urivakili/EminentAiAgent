using EminentAi.Application.Agents;

namespace EminentAi.Application.Routing;

/// <summary>
/// Result of intent classification. Contains no model or provider knowledge
/// — that is IModelRouter's responsibility.
/// </summary>
public sealed record IntentDecision(
    AgentKind Intent,
    AgentProfile Profile,
    string ClassifierModel,
    long ClassificationMs,
    ClassificationRecord Telemetry
);
