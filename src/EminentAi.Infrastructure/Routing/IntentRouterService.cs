using System.Diagnostics;
using System.Text.RegularExpressions;
using EminentAi.Application.Abstractions;
using EminentAi.Application.Agents;
using EminentAi.Application.Routing;
using Microsoft.Extensions.Logging;

namespace EminentAi.Infrastructure.Routing;

/// <summary>
/// Classifies user intent without any model or provider knowledge.
/// Uses fast regex paths for obvious cases, falls back to qwen3:8b for higher-accuracy classification.
/// All unknown labels default to General — never throws on parse failure.
/// </summary>
public sealed class IntentRouterService(
    IOllamaClient ollama,
    ILogger<IntentRouterService> logger) : IIntentRouter
{
    private const string ClassifierModel = "qwen3:8b";

    // Fast-path: image attached + "read / extract / what / describe / tell me about / text in"
    private static readonly Regex VisionKeywords =
        new(@"\b(read|extract|what|describe|tell me about|text in|ocr|transcribe)\b",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // Fast-path: image generation trigger phrases
    // Also catches quoted-prompt lists like: "A cute baby", "Bold text on dark background"
    private static readonly Regex ImageGenKeywords =
        new(@"^(generate|draw|create a (logo|image|picture|banner)|design an? image|make an? logo)|^\s*""[^""]{3,}""(\s*,\s*""[^""]{3,}"")*\s*$",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // Strips everything except A-Z and underscore for safe enum matching
    private static readonly Regex LabelSanitizer =
        new(@"[^A-Z_]", RegexOptions.Compiled);

    private static readonly string ClassifyPrompt = """
        You are a one-word classifier. Reply with EXACTLY ONE label — no punctuation, no explanation.

        VISION         — user attached an image and wants to read, extract, or analyse it
        CODING         — user wants working code, a coding example, debugging, or code review
        ARCHITECTURE   — user wants system design, tech stack plan, HLD, LLD, or diagrams
        IMAGE_GEN      — user wants to generate, draw, or create an image, logo, or graphic
        GENERAL        — anything else
        """;

    public async Task<IntentDecision> ClassifyAsync(IntentRequest request, CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();

        // --- Fast-path checks (no LLM call) ---
        var fastKind = TryFastPath(request);
        if (fastKind.HasValue)
        {
            sw.Stop();
            var profile = AgentProfiles.ForKind(fastKind.Value);
            logger.LogDebug("Intent fast-path: {Kind} in {Ms}ms", fastKind.Value, sw.ElapsedMilliseconds);
            return new IntentDecision(
                Intent: fastKind.Value,
                Profile: profile,
                ClassifierModel: "fast-path",
                ClassificationMs: sw.ElapsedMilliseconds,
                Telemetry: new ClassificationRecord(
                    RawLabel: fastKind.Value.ToString(),
                    WasFastPath: true,
                    ManualOverrideApplied: false,
                    OverrideRequestedKind: null,
                    OverrideRejectedReason: null)
            );
        }

        // --- LLM classification ---
        var prompt = $"{ClassifyPrompt}\n\nHasImageAttachment: {request.HasImageAttachment.ToString().ToLower()}\nUserMessage: {request.UserText}";
        var chatRequest = new ChatRequest(ClassifierModel,
            new List<ChatMessage> { new("user", prompt) },
            Temperature: 0.0f,
            ContextWindow: 512);

        string rawLabel;
        try
        {
            rawLabel = await ollama.ChatOnceAsync(chatRequest, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Classifier LLM call failed, defaulting to General");
            rawLabel = "GENERAL";
        }

        sw.Stop();
        var intent = ParseIntentLabel(rawLabel);
        var agentProfile = AgentProfiles.ForKind(intent);

        logger.LogDebug("Intent classified: {Kind} (raw: {Raw}) in {Ms}ms", intent, rawLabel.Trim(), sw.ElapsedMilliseconds);

        return new IntentDecision(
            Intent: intent,
            Profile: agentProfile,
            ClassifierModel: ClassifierModel,
            ClassificationMs: sw.ElapsedMilliseconds,
            Telemetry: new ClassificationRecord(
                RawLabel: rawLabel,
                WasFastPath: false,
                ManualOverrideApplied: false,
                OverrideRequestedKind: null,
                OverrideRejectedReason: null)
        );
    }

    private static AgentKind? TryFastPath(IntentRequest request)
    {
        if (request.HasImageAttachment && VisionKeywords.IsMatch(request.UserText))
            return AgentKind.Vision;

        if (ImageGenKeywords.IsMatch(request.UserText))
            return AgentKind.ImageGeneration;

        return null;
    }

    private AgentKind ParseIntentLabel(string raw)
    {
        var clean = LabelSanitizer.Replace(raw.Trim().ToUpperInvariant(), "");
        var kind = clean switch
        {
            "VISION"                                  => AgentKind.Vision,
            "CODING"                                  => AgentKind.Coding,
            "ARCHITECTURE"                            => AgentKind.Architecture,
            "IMAGE_GEN" or "IMAGEGEN" or "IMAGE"      => AgentKind.ImageGeneration,
            "GENERAL"                                 => AgentKind.General,
            _ => (AgentKind?)null
        };

        if (kind is null)
        {
            logger.LogWarning("Unknown intent label {Raw} — defaulting to General", raw.Trim());
            return AgentKind.General;
        }

        return kind.Value;
    }
}
