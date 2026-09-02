using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using EminentAi.Application.Abstractions;
using EminentAi.Application.Agents;
using EminentAi.Application.Configuration;
using EminentAi.Application.Routing;
using Microsoft.Extensions.Logging;

namespace EminentAi.Infrastructure.Routing;

/// <summary>
/// Resolves intent for free-text chat (no UI mode / manualRouteOverride) via structured tool
/// calling on the resident general model, replacing <c>IntentRouterService</c>'s raw-string
/// classification prompt (§18.5.3 / §18.7 Phase 3 of AGENT_2_AGENT_ARCHITECTURE.md).
///
/// Scope note: this removes the fragile parts of the old design — a one-word text label parsed
/// with a regex sanitizer (§18.2 item 3's brittleness), and the quoted-string fast-path that could
/// misroute Vision text into image generation (§18.2 item 6, removed below).
///
/// §15 item 1: when none of the routing tools match, the model is instructed to answer the user's
/// message directly in the same call instead of replying with nothing. That generated text is
/// carried on <see cref="IntentDecision.PrehydratedResponse"/> so the orchestrator can persist it
/// as the final General answer without a second inference round-trip. The output-token cap is
/// therefore removed: a tool call still terminates generation almost immediately (so Coding/
/// Architecture/Vision/ImageGeneration routing stays cheap), while a General decision now costs the
/// same one round-trip it always did — the difference is that round-trip's content is no longer
/// thrown away. Reuse is opportunistic only: the orchestrator still falls back to a normal General
/// dispatch whenever the resolved model differs from <see cref="IntentDecision.ClassifierModel"/>.
/// </summary>
public sealed class ToolCallingIntentResolver(
    IOllamaClient ollama,
    ModelMatrixOptions modelMatrix,
    ILogger<ToolCallingIntentResolver> logger) : IIntentRouter
{
    private readonly string _residentModel = modelMatrix.ClassifierPrimary;
    private readonly string _fallbackModel = modelMatrix.ClassifierFallback;

    // Vision fast-path retained: zero cost and low false-positive risk, since it requires an
    // actual image attachment, not just matching words. The old ImageGenKeywords quoted-string
    // fast-path (§18.2 item 6) is deliberately NOT carried forward — tool-calling below judges the
    // whole message instead of matching a single regex against it.
    private static readonly Regex VisionKeywords =
        new(@"\b(read|extract|what|describe|tell me about|text in|ocr|transcribe)\b",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly List<ToolSchema> RoutingTools =
    [
        EmptyTool("respond_as_code",
            "Call this when the user wants working code, a coding example, debugging help, or a code review."),
        EmptyTool("respond_as_architecture",
            "Call this when the user wants system design, a tech-stack plan, HLD/LLD, or architecture diagrams."),
        EmptyTool("generate_infographic",
            "Call this when the user wants an educational infographic image generated, drawn, or created."),
        EmptyTool("analyze_attached_image",
            "Call this when the user attached an image and wants it read, described, or analysed."),
    ];

    private const string SystemPrompt =
        "Decide how to handle the user's next message. If it clearly matches one of the available " +
        "tools, call exactly that one tool with no arguments and nothing else. If none of the tools " +
        "clearly applies (a general question, conversation, or anything not covered), do not call " +
        "any tool — instead answer the user's message directly and completely, as you normally would.";

    public async Task<IntentDecision> ClassifyAsync(IntentRequest request, CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();

        if (request.HasImageAttachment && VisionKeywords.IsMatch(request.UserText))
        {
            sw.Stop();
            return FastPathDecision(AgentKind.Vision, sw.ElapsedMilliseconds);
        }

        var userContent = request.HasImageAttachment
            ? $"[Image Attached: Yes]\n{request.UserText}"
            : request.UserText;

        var chatRequest = new ChatRequest(
            _residentModel,
            new List<ChatMessage>
            {
                new("system", SystemPrompt),
                new("user", userContent)
            },
            Temperature: 0.0f,
            ContextWindow: 512,
            Tools: RoutingTools);

        AgentKind intent;
        string classifierModel = _residentModel;
        string rawLabel;
        string? prehydratedResponse = null;
        Usage? prehydratedUsage = null;

        try
        {
            var (toolCalls, content, usage) = await RunClassifierStreamAsync(chatRequest, ct);
            var toolName = toolCalls.FirstOrDefault()?.Name;
            intent = MapToolNameToIntent(toolName);
            rawLabel = toolName ?? "NO_TOOL_CALL";

            if (toolName is null && !string.IsNullOrWhiteSpace(content))
            {
                prehydratedResponse = content;
                prehydratedUsage = usage;
            }
        }
        catch (Exception primaryEx) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(primaryEx,
                "Tool-calling intent resolution failed on primary {Model}; attempting fallback {Fallback}",
                _residentModel, _fallbackModel);

            if (!string.IsNullOrWhiteSpace(_fallbackModel) && !_fallbackModel.Equals(_residentModel, StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    var fallbackRequest = chatRequest with { Model = _fallbackModel };
                    var (toolCalls, content, usage) = await RunClassifierStreamAsync(fallbackRequest, ct);
                    var toolName = toolCalls.FirstOrDefault()?.Name;
                    intent = MapToolNameToIntent(toolName);
                    classifierModel = _fallbackModel;
                    rawLabel = toolName ?? "NO_TOOL_CALL";

                    if (toolName is null && !string.IsNullOrWhiteSpace(content))
                    {
                        prehydratedResponse = content;
                        prehydratedUsage = usage;
                    }
                }
                catch (Exception fallbackEx) when (!ct.IsCancellationRequested)
                {
                    logger.LogWarning(fallbackEx,
                        "Tool-calling intent resolution fallback failed on {Fallback}; defaulting to General", _fallbackModel);
                    intent = AgentKind.General;
                    classifierModel = "fallback:general";
                    rawLabel = "RESOLUTION_FAILED";
                }
            }
            else
            {
                intent = AgentKind.General;
                classifierModel = "fallback:general";
                rawLabel = "RESOLUTION_FAILED";
            }
        }

        sw.Stop();
        logger.LogDebug("Intent resolved via tool-call: {Kind} (tool: {Raw}) in {Ms}ms, prehydrated: {Prehydrated}",
            intent, rawLabel, sw.ElapsedMilliseconds, prehydratedResponse is not null);

        return new IntentDecision(
            Intent: intent,
            Profile: AgentProfiles.ForKind(intent),
            ClassifierModel: classifierModel,
            ClassificationMs: sw.ElapsedMilliseconds,
            Telemetry: new ClassificationRecord(
                RawLabel: rawLabel,
                WasFastPath: false,
                ManualOverrideApplied: false,
                OverrideRequestedKind: null,
                OverrideRejectedReason: null),
            PrehydratedResponse: prehydratedResponse,
            PrehydratedUsage: prehydratedUsage);
    }

    private async Task<(List<ToolCall> ToolCalls, string? Content, Usage? Usage)> RunClassifierStreamAsync(
        ChatRequest request, CancellationToken ct)
    {
        var toolCalls = new List<ToolCall>();
        var content = new StringBuilder();
        Usage? usage = null;

        await foreach (var delta in ollama.ChatStreamAsync(request, ct))
        {
            if (delta.ToolCalls is { Count: > 0 } calls)
                toolCalls.AddRange(calls);
            if (delta.Token is not null)
                content.Append(delta.Token);
            if (delta.Done)
                usage = delta.Usage;
        }

        return (toolCalls, content.Length > 0 ? content.ToString() : null, usage);
    }

    private static AgentKind MapToolNameToIntent(string? toolName) => toolName switch
    {
        "respond_as_code" => AgentKind.Coding,
        "respond_as_architecture" => AgentKind.Architecture,
        "generate_infographic" => AgentKind.ImageGeneration,
        "analyze_attached_image" => AgentKind.Vision,
        _ => AgentKind.General
    };

    private static IntentDecision FastPathDecision(AgentKind kind, long ms) => new(
        Intent: kind,
        Profile: AgentProfiles.ForKind(kind),
        ClassifierModel: "fast-path",
        ClassificationMs: ms,
        Telemetry: new ClassificationRecord(
            RawLabel: kind.ToString(),
            WasFastPath: true,
            ManualOverrideApplied: false,
            OverrideRequestedKind: null,
            OverrideRejectedReason: null));

    private static ToolSchema EmptyTool(string name, string description) =>
        new(name, description, new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject()
        });
}
