using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using EminentAi.Application.Abstractions;
using EminentAi.Application.Chat;
using EminentAi.Application.Configuration;
using EminentAi.Application.Routing;
using EminentAi.Domain;

namespace EminentAi.Application.Agents.ImageGeneration;

/// <summary>
/// Agent-to-agent educational-infographic generation pipeline. Every image produced
/// here uses the SAME fixed visual design (<see cref="InfographicPromptBuilder"/>) —
/// only the topic content (title, subtitle, cards, best practices) varies per request,
/// so the whole series looks consistent.
///
///   Agent 1 — gemma4:e4b (content architect), qwen3.5:9b fallback
///     Reads the user's topic request and produces the CONTENT for the infographic
///     (title, subtitle, up to <see cref="InfographicPromptBuilder.MaxCards"/> cards,
///     best practices) as JSON. It never touches visual style — that is fixed.
///
///   Agent 2 — x/flux2-klein:latest (image generator, primary)
///              x/z-image-turbo (image generator, fallback)
///     Receives the fixed design merged with the generated content and produces a PNG.
///
/// Full pipeline sequence:
///   1. gemma4:e4b       → analyse topic, expand to N infographic content blocks [VRAM: other models still loaded]
///   2. Snapshot loaded models
///   3. Kill ALL loaded models to free VRAM for image gen
///   4. x/flux2-klein:latest → generate image for each infographic (falls back to x/z-image-turbo on failure)
///   5. Save each PNG to Generated_images/
///   6. Restore previously loaded models (fire-and-forget)
/// </summary>
public sealed class ImageGenerationAgent(
    IOllamaClient ollama,
    IGeneratedImageRepository imageRepo,
    IConversationRepository conversationRepo,
    IPiiRedactor redactor,
    ModelMatrixOptions modelMatrix,
    string outputDirectory) : ISpecializedAgent
{
    // §18.2 item 4: model names are config-driven (ModelMatrixOptions) rather than hardcoded
    // constants — defaults below match what was previously hardcoded, so behaviour is unchanged
    // unless appsettings.json overrides EminentAi:ModelMatrix.
    private readonly string PrimaryModel  = modelMatrix.ImageGenPrimary;
    private readonly string FallbackModel = modelMatrix.ImageGenFallback;
    private readonly string PrimaryAnalystModel  = modelMatrix.ImageAnalystPrimary;
    private readonly string FallbackAnalystModel = modelMatrix.ImageAnalystFallback;
    private readonly string PrimaryVisionModel   = modelMatrix.ImageVisionPrimary;
    private readonly string FallbackVisionModel  = modelMatrix.ImageVisionFallback;
    private readonly bool UseHttpGenerate        = modelMatrix.UseHttpGenerateForImages;

    // Strips qwen3 <think>…</think> reasoning blocks before JSON parsing
    private static readonly Regex ThinkBlockRegex =
        new(@"<think>[\s\S]*?</think>", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly string AnalystSystemPrompt = $$"""
        You are an expert content architect working inside an agent pipeline that renders
        software-engineering educational infographics using a FIXED visual design template.
        Your ONLY job is to convert the user's topic request into the CONTENT for that
        infographic (title, subtitle, cards, best practices) and return it as JSON.
        Do NOT describe visual style, colours or layout — the design is fixed elsewhere.
        Focus purely on accurate, concise educational content.

        RULES
        ─────
        1. Identify the core topic (e.g. "SOLID principles", "caching strategies").
        2. Break the topic into individual concepts, one per card.
        3. Use AT MOST {{InfographicPromptBuilder.MaxCards}} cards. If the topic naturally has
           more concepts than that, choose the {{InfographicPromptBuilder.MaxCards}} most
           important ones — never invent filler cards to pad the count.
        4. Each card needs:
           - a short (2-4 word) UPPERCASE title
           - a one-line description of a simple technical diagram illustrating it
             (e.g. "Producer → Event Bus → multiple Consumers")
           - EXACTLY three bullet points, each under five words
        5. Provide 4-6 short "best practices" labels (1-3 words each) relevant to the topic.
        6. If the user asks for multiple distinct topics in one request, create a SEPARATE
           infographic object for EACH topic.
        7. Keep all text short, technically accurate, correctly spelled and jargon-free.
        8. Output ONLY valid JSON — no markdown, no explanation, no prose:
        {
          "understanding": "One sentence: what topic(s) you are covering",
          "infographics": [
            {
              "title": "SHORT TITLE",
              "subtitle": "SHORT SUBTITLE",
              "cards": [
                { "title": "CARD TITLE", "diagram": "A -> B -> C", "bullets": ["...", "...", "..."] }
              ],
              "bestPractices": ["...", "..."]
            }
          ]
        }
        """;

    public AgentKind Kind => AgentKind.ImageGeneration;

    public async IAsyncEnumerable<SmartChatEvent> ExecuteAsync(
        SmartChatContext context,
        ModelRoute route,
        [EnumeratorCancellation] CancellationToken ct)
    {
        // ── Persist the user message immediately, before the slow pipeline runs,
        //    so it survives even if the client disconnects mid-generation ──────
        var redactedUserText = redactor.Redact(context.UserText);

        var userMessage = new Message
        {
            BranchId = context.BranchId,
            Role     = MessageRole.User,
            Content  = redactedUserText
        };

        var imageAttachments = context.Attachments
            .Where(a => a.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            .ToList();

        foreach (var attachment in imageAttachments)
        {
            userMessage.Attachments.Add(new MessageAttachment
            {
                MessageId   = userMessage.Id,
                Name        = attachment.Name,
                ContentType = attachment.ContentType,
                DataBase64  = attachment.DataBase64
            });
        }

        await conversationRepo.AddMessageAsync(userMessage, ct);
        await conversationRepo.SaveChangesAsync(ct);

        // ── Stage 0: describe any attached reference image (vision model) ────
        string? referenceDescription = imageAttachments.Count > 0
            ? await DescribeReferenceImagesAsync(imageAttachments, ct)
            : null;

        // ── Stage 1: Gemma analyses the request and expands to Flux prompts ─
        yield return new SmartChatEvent("image_gen_progress", new
        {
            stage        = "analyzing_request",
            analystModel = PrimaryAnalystModel
        });

        var rawAnalysis = await AnalyzeAndExpandPromptsAsync(context.UserText, referenceDescription, ct);

        // §18.2 item 7: redact model-echoed text here, once, before it is ever emitted in SSE or
        // persisted — previously only UserText and the per-image FluxPrompt (at generation time)
        // were redacted, leaving Understanding/Description able to resurface PII the analyst model
        // echoed back from its (unredacted) input.
        var analysis = rawAnalysis with
        {
            Understanding = redactor.Redact(rawAnalysis.Understanding),
            Prompts = rawAnalysis.Prompts
                .Select(p => p with
                {
                    Description = redactor.Redact(p.Description),
                    FluxPrompt  = redactor.Redact(p.FluxPrompt)
                })
                .ToList()
        };

        yield return new SmartChatEvent("image_gen_progress", new
        {
            stage         = "analysis_done",
            understanding = analysis.Understanding,
            analystModel   = analysis.AnalystModel,
            total         = analysis.Prompts.Count,
            prompts       = analysis.Prompts.Select(p => new { p.Description, p.FluxPrompt })
        });

        // ── Stage 2: snapshot currently loaded models ─────────────────────────
        IReadOnlyList<LoadedModelInfo> loadedBefore;
        try   { loadedBefore = await ollama.GetLoadedModelsAsync(ct); }
        catch { loadedBefore = Array.Empty<LoadedModelInfo>(); }

        // ── Stage 3: kill ALL models to give Flux full VRAM ──────────────────
        if (loadedBefore.Count > 0)
        {
            yield return new SmartChatEvent("image_gen_progress", new
            {
                stage         = "freeing_vram",
                killingModels = loadedBefore.Select(m => m.Name).ToArray()
            });

            foreach (var m in loadedBefore)
                await ollama.UnloadModelAsync(m.Name, ct);

            await Task.Delay(500, ct); // let Ollama finish eviction
        }

        // ── Stage 4 & 5: generate + save each expanded prompt ────────────────
        var generatedResults = new List<GeneratedImageEntry>();
        var expandedPrompts  = analysis.Prompts;

        for (var i = 0; i < expandedPrompts.Count; i++)
        {
            var ep = expandedPrompts[i]; // Description/FluxPrompt already redacted above

            yield return new SmartChatEvent("image_gen_progress", new
            {
                stage       = "generating",
                current     = i + 1,
                total       = expandedPrompts.Count,
                prompt      = ep.FluxPrompt,
                description = ep.Description
            });

            var sw       = Stopwatch.StartNew();
            string? base64Png       = null;
            string? genError        = null;
            string? primaryFailMsg  = null;

            try
            {
                base64Png = await FluxImageGenerator.GenerateAsync(PrimaryModel, ep.FluxPrompt, ct, ollama, UseHttpGenerate);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception primaryEx)
            {
                primaryFailMsg = primaryEx.Message;
            }

            if (primaryFailMsg is not null)
            {
                yield return new SmartChatEvent("image_gen_progress", new
                {
                    stage    = "primary_model_failed",
                    model    = PrimaryModel,
                    fallback = FallbackModel,
                    error    = primaryFailMsg,
                    current  = i + 1,
                    total    = expandedPrompts.Count
                });

                try   { base64Png = await FluxImageGenerator.GenerateAsync(FallbackModel, ep.FluxPrompt, ct, ollama, UseHttpGenerate); }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                catch (Exception ex) { genError = ex.Message; }
            }

            sw.Stop();

            if (genError is not null || string.IsNullOrEmpty(base64Png))
            {
                yield return new SmartChatEvent("image_gen_progress", new
                {
                    stage   = "gen_failed",
                    current = i + 1,
                    total   = expandedPrompts.Count,
                    error   = genError ?? "Empty output from model"
                });
                continue;
            }

            yield return new SmartChatEvent("image_gen_progress", new
            {
                stage   = "saving",
                current = i + 1,
                total   = expandedPrompts.Count
            });

            string  filename;
            string? saveError = null;
            try   { (_, filename) = await SaveImageAsync(base64Png, ct); }
            catch (Exception ex) { filename = ""; saveError = ex.Message; }

            if (saveError is not null)
            {
                yield return new SmartChatEvent("image_gen_progress", new
                {
                    stage   = "save_failed",
                    current = i + 1,
                    total   = expandedPrompts.Count,
                    error   = saveError
                });
                continue;
            }

            var imageId  = Guid.Parse(Path.GetFileNameWithoutExtension(filename));
            var imageUrl = $"/api/generated-images/{filename}";

            generatedResults.Add(new GeneratedImageEntry(
                imageId, imageUrl, filename, ep.FluxPrompt,
                ep.Description, sw.ElapsedMilliseconds));

            yield return new SmartChatEvent("image_generated", new
            {
                url          = imageUrl,
                filename,
                fluxPrompt   = ep.FluxPrompt,
                description  = ep.Description,
                index        = i + 1,
                total        = expandedPrompts.Count,
                generationMs = sw.ElapsedMilliseconds
            });
        }

        // ── Stage 6: restore previously loaded models (fire-and-forget) ──────
        if (loadedBefore.Count > 0)
        {
            yield return new SmartChatEvent("image_gen_progress", new
            {
                stage  = "restoring_models",
                models = loadedBefore.Select(m => m.Name).ToArray()
            });

            foreach (var m in loadedBefore)
                _ = ollama.WarmUpModelAsync(m.Name, CancellationToken.None);
        }

        if (generatedResults.Count == 0)
        {
            yield return new SmartChatEvent("routing_error", new
            {
                intent  = "imageGeneration",
                message = "All image generation attempts failed. " +
                          $"Ensure models are installed: ollama pull {PrimaryModel} && ollama pull {FallbackModel}"
            });
            yield break;
        }

        // ── Persist assistant message using CancellationToken.None: images were
        //    already generated, so a client disconnect here must not lose them ──
        var header     = $"> **{analysis.AnalystModel} understood:** {analysis.Understanding}\n\n";
        var imageLines = generatedResults.Select((r, idx) =>
            $"**{r.Description}**\n\n![{r.Description}]({r.Url})\n\n" +
            $"*Prompt: {r.FluxPrompt}*");
        var messageContent = header + string.Join("\n\n---\n\n", imageLines);

        var assistantMessage = new Message
        {
            BranchId        = context.BranchId,
            Role            = MessageRole.Assistant,
            Content         = messageContent,
            Model           = PrimaryModel,
            ParentMessageId = userMessage.Id
        };

        foreach (var r in generatedResults)
            await imageRepo.AddAsync(r.ImageId, context.BranchId, context.RequestTokenHash, CancellationToken.None);

        await conversationRepo.AddMessageAsync(assistantMessage, CancellationToken.None);
        await conversationRepo.SaveChangesAsync(CancellationToken.None);

        yield return new SmartChatEvent("done", new { messageId = assistantMessage.Id.ToString() });
    }

    // ── Agent 0: qwen3-vl describes any reference image the user attached ────

    private async Task<string?> DescribeReferenceImagesAsync(
        List<ChatAttachment> imageAttachments, CancellationToken ct)
    {
        var request = new ChatRequest(
            PrimaryVisionModel,
            new List<ChatMessage>
            {
                new("user",
                    "Describe this reference image in one or two sentences for an image-generation " +
                    "prompt: subject, style, colours, composition. Be concise and objective.",
                    imageAttachments.Select(a => a.DataBase64).ToList())
            },
            Temperature: 0.1f,
            ContextWindow: 2048);

        try
        {
            return (await ollama.ChatOnceAsync(request, ct)).Trim();
        }
        catch
        {
            try
            {
                return (await ollama.ChatOnceAsync(request with { Model = FallbackVisionModel }, ct)).Trim();
            }
            catch
            {
                return null;
            }
        }
    }

    // ── Agent 1: Gemma content analysis ──────────────────────────────────────

    private async Task<AnalysisResult> AnalyzeAndExpandPromptsAsync(
        string userText, string? referenceDescription, CancellationToken ct)
    {
        var analystInput = referenceDescription is null
            ? userText
            : $"Reference image: {referenceDescription}\n\nUser request: {userText}";

        var request = new ChatRequest(
            PrimaryAnalystModel,
            new List<ChatMessage>
            {
                new("system", AnalystSystemPrompt),
                new("user",   analystInput)
            },
            Temperature:   0.2f,
            ContextWindow: 4096,
            ForceJson:     true);

        var analystModel = PrimaryAnalystModel;
        string rawJson;
        try
        {
            rawJson = await ollama.ChatOnceAsync(request, ct);
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            analystModel = FallbackAnalystModel;
            try
            {
                rawJson = await ollama.ChatOnceAsync(request with { Model = analystModel }, ct);
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                return FallbackResult(userText);
            }
        }

        // Strip reasoning blocks before JSON parsing
        rawJson = ThinkBlockRegex.Replace(rawJson, "").Trim();

        // Extract first JSON object if extra text leaked through
        var braceStart = rawJson.IndexOf('{');
        var braceEnd   = rawJson.LastIndexOf('}');
        if (braceStart >= 0 && braceEnd > braceStart)
            rawJson = rawJson[braceStart..(braceEnd + 1)];

        try
        {
            using var doc          = JsonDocument.Parse(rawJson);
            var root               = doc.RootElement;
            var understanding      = root.TryGetProperty("understanding", out var u) ? u.GetString() ?? "" : "";
            var infographicsElement = root.GetProperty("infographics");
            var expandedPrompts    = new List<ExpandedPrompt>();

            foreach (var ig in infographicsElement.EnumerateArray())
            {
                var title    = ig.TryGetProperty("title",    out var t) ? t.GetString() ?? "" : "";
                var subtitle = ig.TryGetProperty("subtitle", out var s) ? s.GetString() ?? "" : "";

                var cards = new List<InfographicCard>();
                if (ig.TryGetProperty("cards", out var cardsElement))
                {
                    foreach (var c in cardsElement.EnumerateArray())
                    {
                        var cardTitle = c.TryGetProperty("title",   out var ct2) ? ct2.GetString() ?? "" : "";
                        var diagram   = c.TryGetProperty("diagram", out var dg)  ? dg.GetString()  ?? "" : "";
                        var bullets   = c.TryGetProperty("bullets", out var bl)
                            ? bl.EnumerateArray().Select(b => b.GetString() ?? "").Where(b => b.Length > 0).ToList()
                            : new List<string>();

                        if (cardTitle.Length > 0 && bullets.Count > 0)
                            cards.Add(new InfographicCard(cardTitle, diagram, bullets));
                    }
                }

                var bestPractices = ig.TryGetProperty("bestPractices", out var bp)
                    ? bp.EnumerateArray().Select(p => p.GetString() ?? "").Where(p => p.Length > 0).ToList()
                    : new List<string>();

                if (title.Length == 0 || cards.Count == 0) continue;

                var spec = new InfographicSpec(title, subtitle, cards, bestPractices);
                expandedPrompts.Add(new ExpandedPrompt(
                    subtitle.Length > 0 ? $"{title} — {subtitle}" : title,
                    InfographicPromptBuilder.BuildPrompt(spec)));
            }

            if (expandedPrompts.Count > 0)
                return new AnalysisResult(understanding, expandedPrompts, analystModel);
        }
        catch { /* fall through to fallback */ }

        return FallbackResult(userText);
    }

    private static AnalysisResult FallbackResult(string userText)
    {
        var spec = new InfographicSpec(
            Title: "OVERVIEW",
            Subtitle: "",
            Cards: new List<InfographicCard>
            {
                new("SUMMARY", "N/A", new List<string> { userText.Trim() })
            },
            BestPractices: new List<string>());

        var prompts = new List<ExpandedPrompt> { new("Image", InfographicPromptBuilder.BuildPrompt(spec)) };
        return new AnalysisResult("(analyst models unavailable — using raw topic text)", prompts, "raw prompt fallback");
    }

    // ── Image save ───────────────────────────────────────────────────────────

    private async Task<(string FullPath, string Filename)> SaveImageAsync(
        string base64Raw, CancellationToken ct)
    {
        Directory.CreateDirectory(outputDirectory);

        var base64 = (base64Raw.Contains(',')
            ? base64Raw[(base64Raw.IndexOf(',') + 1)..]
            : base64Raw)
            .Replace("\r", "").Replace("\n", "").Replace(" ", "").Trim();

        if (base64.Length == 0)
            throw new InvalidOperationException("Empty image response from model.");

        byte[] bytes;
        try   { bytes = Convert.FromBase64String(base64); }
        catch (FormatException ex)
        {
            throw new InvalidOperationException(
                $"Invalid base64 (first 40 chars: '{base64[..Math.Min(40, base64.Length)]}'). {ex.Message}", ex);
        }

        var ext = FluxImageGenerator.DetectImageFormat(bytes)
            ?? throw new InvalidOperationException(
                $"Unrecognised image format " +
                $"(magic: {string.Join(" ", bytes.Take(4).Select(b => b.ToString("X2")))}).");

        var filename = $"{Guid.NewGuid()}.{ext}";
        var fullPath = Path.GetFullPath(Path.Combine(outputDirectory, filename));

        var safeRoot = outputDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                       + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(safeRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Path escapes output directory: {fullPath}");

        await File.WriteAllBytesAsync(fullPath, bytes, ct);
        return (fullPath, filename);
    }

    // ── Internal records ──────────────────────────────────────────────────────

    private sealed record ExpandedPrompt(string Description, string FluxPrompt);

    private sealed record AnalysisResult(
        string Understanding,
        List<ExpandedPrompt> Prompts,
        string AnalystModel);

    private sealed record GeneratedImageEntry(
        Guid   ImageId,
        string Url,
        string Filename,
        string FluxPrompt,
        string Description,
        long   GenerationMs);
}
