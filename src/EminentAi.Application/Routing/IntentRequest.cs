namespace EminentAi.Application.Routing;

/// <summary>
/// Input to IIntentRouter. manualRouteOverride is handled by AgentOrchestratorFacade
/// before reaching the router — this record contains no override field by design.
/// </summary>
public sealed record IntentRequest(
    string UserText,
    bool HasImageAttachment,
    IReadOnlyList<string> AttachmentContentTypes
);
