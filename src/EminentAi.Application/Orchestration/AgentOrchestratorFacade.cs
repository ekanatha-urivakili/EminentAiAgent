using System.Runtime.CompilerServices;
using EminentAi.Application.Agents;
using EminentAi.Application.Chat;
using EminentAi.Application.Providers;
using EminentAi.Application.Routing;

namespace EminentAi.Application.Orchestration;

/// <summary>
/// Owns the complete smart-chat turn:
///   1. Validate manualRouteOverride
///   2. Classify intent (IIntentRouter)
///   3. Resolve model (IModelRouter)
///   4. Emit routing_decision SSE (only after BOTH intent AND model are known)
///   5. Dispatch to ISpecializedAgent
///   6. Propagate all SmartChatEvents to the SSE response
/// </summary>
public sealed class AgentOrchestratorFacade(
    IIntentRouter intentRouter,
    IModelRouter modelRouter,
    IEnumerable<ISpecializedAgent> agents,
    CostPolicy costPolicy,
    DataResidencyPolicy residencyPolicy)
{
    // Combined intent + route — AOF-internal only, never a public contract
    private sealed record RoutingDecision(IntentDecision Intent, ModelRoute Route);

    public async IAsyncEnumerable<SmartChatEvent> ExecuteSmartTurnAsync(
        SmartTurnRequest request,
        [EnumeratorCancellation] CancellationToken ct)
    {
        // Step 1: validate manual override
        var (overrideKind, overrideRejectedReason) = ValidateManualOverride(
            request.ManualRouteOverride,
            request.HasImageAttachment);

        if (overrideRejectedReason is not null)
        {
            yield return new SmartChatEvent("routing_error", new { message = overrideRejectedReason });
            yield break;
        }

        // Step 2 & 3: Run classification and model list pre-fetching in parallel
        var intentTask = overrideKind.HasValue
            ? Task.FromResult(new IntentDecision(
                Intent: overrideKind.Value,
                Profile: AgentProfiles.ForKind(overrideKind.Value),
                ClassifierModel: "manual-override",
                ClassificationMs: 0,
                Telemetry: new ClassificationRecord(
                    RawLabel: overrideKind.Value.ToString(),
                    WasFastPath: false,
                    ManualOverrideApplied: true,
                    OverrideRequestedKind: request.ManualRouteOverride,
                    OverrideRejectedReason: overrideRejectedReason)))
            : intentRouter.ClassifyAsync(new IntentRequest(
                request.UserText,
                request.HasImageAttachment,
                request.AttachmentContentTypes), ct);

        // While intent classification is running, we can start pre-fetching the model list
        // and resolving for the most likely case (General) or just waiting for BOTH.
        var intentDecision = await intentTask;

        // Model resolution depends on the intent's profile.
        var route = await modelRouter.ResolveAsync(intentDecision.Profile, costPolicy, residencyPolicy, ct);

        if (route is null)
        {
            yield return new SmartChatEvent("routing_error", new
            {
                intent = intentDecision.Intent.ToString().ToLowerInvariant(),
                message = $"No model available for {intentDecision.Intent}. Install required model with ollama pull.",
                ollamaPullCommand = RecommendedPullCommand(intentDecision.Intent)
            });
            yield break;
        }

        // Step 4: emit routing_decision
        yield return new SmartChatEvent("routing_decision", new
        {
            intent = intentDecision.Intent.ToString().ToLowerInvariant(),
            model = route.Model.Name,
            provider = route.ProviderName,
            reason = route.SelectionReason,
            classificationMs = intentDecision.ClassificationMs,
            wasFastPath = intentDecision.Telemetry.WasFastPath,
            manualOverrideApplied = intentDecision.Telemetry.ManualOverrideApplied
        });

        // Step 5: dispatch to specialized agent
        var agent = ResolveAgent(intentDecision.Intent);
        var context = new SmartChatContext(
            BranchId: request.BranchId,
            UserText: request.UserText,
            Attachments: request.Attachments,
            Intent: intentDecision,
            RequestTokenHash: request.RequestTokenHash);

        // Step 6: propagate all events
        await foreach (var evt in agent.ExecuteAsync(context, route, ct))
            yield return evt;
    }

    /// <summary>
    /// Validates the manual override before classification.
    /// Returns (null, null) when override is null.
    /// Returns (kind, null) when override is valid and allowed.
    /// Returns (null, reason) when override is rejected — falls through to normal classification.
    /// </summary>
    private static (AgentKind? Kind, string? RejectedReason) ValidateManualOverride(
        AgentKind? override_, bool hasImage)
    {
        if (override_ is null) return (null, null);

        if (override_ == AgentKind.Vision && !hasImage)
            return (null, "Vision override requires an image attachment");

        return (override_, null);
    }

    private ISpecializedAgent ResolveAgent(AgentKind kind)
    {
        var agent = agents.FirstOrDefault(a => a.Kind == kind)
            ?? agents.First(a => a.Kind == AgentKind.General);

        return agent;
    }

    private static string RecommendedPullCommand(AgentKind intent) => intent switch
    {
        AgentKind.Vision          => "ollama pull qwen2.5vl:latest",
        AgentKind.ImageGeneration => "ollama pull x/flux2-klein:4b",
        AgentKind.Coding          => "ollama pull qwen2.5-coder:7b",
        AgentKind.Architecture    => "ollama pull qwen3:latest",
        _                         => "ollama pull qwen2.5:latest",
    };
}

public sealed record SmartTurnRequest(
    Guid BranchId,
    string UserText,
    IReadOnlyList<ChatAttachment> Attachments,
    bool HasImageAttachment,
    IReadOnlyList<string> AttachmentContentTypes,
    AgentKind? ManualRouteOverride = null,
    string? RequestTokenHash = null
);
