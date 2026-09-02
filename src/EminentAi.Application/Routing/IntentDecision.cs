using EminentAi.Application.Abstractions;
using EminentAi.Application.Agents;

namespace EminentAi.Application.Routing;

/// <summary>
/// Result of intent classification. Contains no model or provider knowledge
/// — that is IModelRouter's responsibility.
/// </summary>
/// <param name="PrehydratedResponse">
/// When the classifier call itself generated a full General answer instead of calling a tool
/// (§15 item 1 of AGENT_2_AGENT_ARCHITECTURE.md), this carries that answer so the orchestrator can
/// persist it directly instead of making a second inference call. Null for every other intent, and
/// for General decisions reached via fallback/failure paths that never generated real content.
/// The caller must still verify <see cref="ClassifierModel"/> matches the resolved route's model
/// before reusing this — otherwise the routing_decision model and the actual response model would
/// disagree.
/// </param>
public sealed record IntentDecision(
    AgentKind Intent,
    AgentProfile Profile,
    string ClassifierModel,
    long ClassificationMs,
    ClassificationRecord Telemetry,
    string? PrehydratedResponse = null,
    Usage? PrehydratedUsage = null
);
