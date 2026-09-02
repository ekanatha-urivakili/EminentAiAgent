using System.Diagnostics;
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
/// misroute Vision text into image generation (§18.2 item 6, removed below). It does NOT attempt
/// the "zero extra inference for General" version of §18.5.3's pseudocode: reusing this call's own
/// generated content as the final answer would require re-plumbing ChatService/GeneralAgent's
/// persistence path in a way that cannot be safely verified without a live Ollama instance in this
/// session. So this still makes one dedicated round-trip per free-text turn — same cost as before,
/// but the decision itself is a native tool call instead of a hand-parsed string, and the call is
/// bounded by MaxOutputTokens so a "no tool matches" turn costs a few tokens, not a full answer.
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
        "tools, call exactly that one tool with no arguments. If none of the tools clearly applies " +
        "(a general question, conversation, or anything not covered), do not call any tool and reply " +
        "with nothing.";

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
            Tools: RoutingTools,
            MaxOutputTokens: 16);

        AgentKind intent;
        string classifierModel = _residentModel;
        string rawLabel;

        try
        {
            var toolCalls = new List<ToolCall>();
            await foreach (var delta in ollama.ChatStreamAsync(chatRequest, ct))
                if (delta.ToolCalls is { Count: > 0 } calls)
                    toolCalls.AddRange(calls);

            var toolName = toolCalls.FirstOrDefault()?.Name;
            intent = MapToolNameToIntent(toolName);
            rawLabel = toolName ?? "NO_TOOL_CALL";
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
                    var toolCalls = new List<ToolCall>();
                    await foreach (var delta in ollama.ChatStreamAsync(fallbackRequest, ct))
                        if (delta.ToolCalls is { Count: > 0 } calls)
                            toolCalls.AddRange(calls);

                    var toolName = toolCalls.FirstOrDefault()?.Name;
                    intent = MapToolNameToIntent(toolName);
                    classifierModel = _fallbackModel;
                    rawLabel = toolName ?? "NO_TOOL_CALL";
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
        logger.LogDebug("Intent resolved via tool-call: {Kind} (tool: {Raw}) in {Ms}ms",
            intent, rawLabel, sw.ElapsedMilliseconds);

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
                OverrideRejectedReason: null));
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
