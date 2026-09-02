using System.Runtime.CompilerServices;
using EminentAi.Application.Agents;
using EminentAi.Application.Chat;
using EminentAi.Application.Hardware;
using EminentAi.Application.Providers;
using EminentAi.Application.Routing;
using Microsoft.Extensions.Logging;

namespace EminentAi.Application.Orchestration;

/// <summary>
/// Owns the complete smart-chat turn:
///   1. Validate manualRouteOverride
///   2. Classify intent (IIntentRouter) — unless override is valid, or was rejected and falls
///      through to classification (§18.2 item 5 fix: a rejected override no longer aborts the turn)
///   3. Resolve model (IModelRouter)
///   4. Emit routing_decision SSE (only after BOTH intent AND model are known)
///   5. Acquire the GPU work lease (§18.5.1), then dispatch to ISpecializedAgent
///   6. Propagate all SmartChatEvents to the SSE response
/// </summary>
public sealed class AgentOrchestratorFacade(
    IIntentRouter intentRouter,
    IModelRouter modelRouter,
    IEnumerable<ISpecializedAgent> agents,
    CostPolicy costPolicy,
    DataResidencyPolicy residencyPolicy,
    IGpuWorkCoordinator gpuCoordinator,
    ILogger<AgentOrchestratorFacade> logger)
{
    // Combined intent + route — AOF-internal only, never a public contract
    private sealed record RoutingDecision(IntentDecision Intent, ModelRoute Route);

    public async IAsyncEnumerable<SmartChatEvent> ExecuteSmartTurnAsync(
        SmartTurnRequest request,
        [EnumeratorCancellation] CancellationToken ct)
    {
        // Step 1: validate manual override. A rejected override (currently: Vision without an
        // image attachment) no longer aborts the turn with routing_error — it falls through to
        // normal classification, exactly as §6.1/§8/§16 always documented but the code never did
        // (§18.2 item 5). The rejection reason still travels with the turn so the UI can explain
        // why the requested mode didn't apply.
        var (overrideKind, overrideRejectedReason) = ValidateManualOverride(
            request.ManualRouteOverride,
            request.HasImageAttachment);

        if (overrideRejectedReason is not null)
            logger.LogWarning(
                "Manual route override rejected ({Reason}); falling back to classification",
                overrideRejectedReason);

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
                    OverrideRejectedReason: null)))
            : intentRouter.ClassifyAsync(new IntentRequest(
                request.UserText,
                request.HasImageAttachment,
                request.AttachmentContentTypes), ct);

        // While intent classification is running, we can start pre-fetching the model list
        // and resolving for the most likely case (General) or just waiting for BOTH.
        var intentDecision = await intentTask;

        if (overrideRejectedReason is not null)
        {
            // Override was requested but rejected — classification ran instead of it. Annotate the
            // telemetry so routing_decision.manualOverrideApplied is false and the rejection is visible.
            intentDecision = intentDecision with
            {
                Telemetry = intentDecision.Telemetry with
                {
                    OverrideRequestedKind = request.ManualRouteOverride,
                    OverrideRejectedReason = overrideRejectedReason
                }
            };
        }

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
            manualOverrideApplied = intentDecision.Telemetry.ManualOverrideApplied,
            overrideRejectedReason = intentDecision.Telemetry.OverrideRejectedReason
        });

        // Step 5: acquire exclusive GPU access for the whole agent turn (§18.5.1), then dispatch.
        // This is what actually closes §18.2 item 1: as long as only one turn at a time holds this
        // lease, ImageGenerationAgent's snapshot/evict/restore dance can no longer race a concurrent
        // text generation on another branch or tab — the two can no longer be "concurrent" at all.
        var agent = ResolveAgent(intentDecision.Intent);
        var context = new SmartChatContext(
            BranchId: request.BranchId,
            UserText: request.UserText,
            Attachments: request.Attachments,
            Intent: intentDecision,
            RequestTokenHash: request.RequestTokenHash);

        using var gpuLease = await gpuCoordinator.AcquireAsync(route.Model.Name, ct: ct);

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

    private static string? RecommendedPullCommand(AgentKind intent) => intent switch
    {
        AgentKind.Vision         => "ollama pull qwen3-vl:latest",
        AgentKind.ImageGeneration => "ollama pull x/flux2-klein:4b",
        _                        => null
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
