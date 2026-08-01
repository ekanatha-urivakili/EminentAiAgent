using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using EminentAi.Application.Abstractions;
using EminentAi.Application.Chat;
using EminentAi.Application.Routing;
using EminentAi.Domain;

namespace EminentAi.Application.Agents.ImageGeneration;

/// <summary>
/// Agent-to-agent image generation pipeline:
///
///   Agent 1 — gemma4:e4b (prompt engineer), qwen3.5:9b fallback
///     Analyses the user's free-text request, understands intent (multiple
///     variants, themes, formats, brand names) and expands it into one or
///     more optimised image prompts while the model is still warm in VRAM.
///
///   Agent 2 — x/flux2-klein:4b (image generator, primary)
///              x/z-image-turbo (image generator, fallback)
///     Receives each polished prompt and produces a PNG.
///
/// Full pipeline sequence:
///   1. gemma4:e4b       → analyse request, expand to N prompts  [VRAM: other models still loaded]
///   2. Snapshot loaded models
///   3. Kill ALL loaded models to free VRAM for image gen
///   4. x/flux2-klein:4b → generate image for each prompt (falls back to x/z-image-turbo on failure)
///   5. Save each PNG to Generated_images/
///   6. Restore previously loaded models (fire-and-forget)
/// </summary>
public sealed class ImageGenerationAgent(
    IOllamaClient ollama,
    IGeneratedImageRepository imageRepo,
    IConversationRepository conversationRepo,
    IPiiRedactor redactor,
    string outputDirectory) : ISpecializedAgent
{
    private const string PrimaryModel  = "x/flux2-klein:4b";
    private const string FallbackModel = "x/z-image-turbo";
    private const string PrimaryAnalystModel  = "gemma4:e4b";
    private const string FallbackAnalystModel = "qwen3.5:9b";

    // Matches text wrapped in double-quotes, e.g. "A cute baby", "Bold text"
    private static readonly Regex QuotedPromptRegex =
        new(@"""((?:[^""\\]|\\.)*)""", RegexOptions.Compiled);

    // Strips qwen3 <think>…</think> reasoning blocks before JSON parsing
    private static readonly Regex ThinkBlockRegex =
        new(@"<think>[\s\S]*?</think>", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly string AnalystSystemPrompt = """
        You are an expert diffusion-model prompt engineer working inside an agent pipeline.
        Your ONLY job is to convert the user's image request into one or more highly optimised
        image generation prompts, then return them as JSON.

        RULES
        ─────
        1. Read the full request carefully: identify brand names, themes, formats, and variants.
        2. If the user asks for MULTIPLE variants (dark / light theme, different sizes, favicon vs
           PWA icon, multiple colour schemes), create a SEPARATE prompt object for EACH variant.
        3. Each "prompt" value must be a comma-separated list of visual descriptors only:
           subject, style, colours, mood, composition, medium, quality boosters.
        4. Include the brand or app name (if any) verbatim in every prompt.
        5. Quality boosters to add when relevant:
           logos → "transparent background, vector art, scalable, professional logo design, crisp edges"
           dark themes → "dark background, #0a0a0a backdrop, vibrant accent colours, high contrast"
           light themes → "white background, clean minimal design, subtle shadows"
           PWA/app icons → "app icon, centred composition, bold icon, rounded corners, 512x512"
           favicons → "favicon, 32x32, simple geometric icon, bold shape"
        6. NEVER use negative phrasing ("no blur") — positives only.
        7. Output ONLY valid JSON — no markdown, no explanation, no prose:
        {
          "understanding": "One sentence: what you understood the user wants",
          "prompts": [
            { "description": "short human-readable label", "prompt": "the Flux2 prompt" }
          ]
        }
        """;

    public AgentKind Kind => AgentKind.ImageGeneration;

    public async IAsyncEnumerable<SmartChatEvent> ExecuteAsync(
        SmartChatContext context,
        ModelRoute route,
        [EnumeratorCancellation] CancellationToken ct)
    {
        // ── Stage 1: Gemma analyses the request and expands to Flux prompts ─
        yield return new SmartChatEvent("image_gen_progress", new
        {
            stage        = "analyzing_request",
            analystModel = PrimaryAnalystModel
        });

        var analysis = await AnalyzeAndExpandPromptsAsync(context.UserText, ct);

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
            var ep             = expandedPrompts[i];
            var redactedPrompt = redactor.Redact(ep.FluxPrompt);

            yield return new SmartChatEvent("image_gen_progress", new
            {
                stage       = "generating",
                current     = i + 1,
                total       = expandedPrompts.Count,
                prompt      = redactedPrompt,
                description = ep.Description
            });

            var sw       = Stopwatch.StartNew();
            string? base64Png       = null;
            string? genError        = null;
            string? primaryFailMsg  = null;

            try
            {
                base64Png = await GenerateViaCliAsync(PrimaryModel, ep.FluxPrompt, ct);
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

                try   { base64Png = await GenerateViaCliAsync(FallbackModel, ep.FluxPrompt, ct); }
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
                imageId, imageUrl, filename, redactedPrompt,
                ep.Description, sw.ElapsedMilliseconds));

            yield return new SmartChatEvent("image_generated", new
            {
                url          = imageUrl,
                filename,
                fluxPrompt   = redactedPrompt,
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

        // ── Persist user + assistant messages ─────────────────────────────────
        var redactedUserText = redactor.Redact(context.UserText);

        var userMessage = new Message
        {
            BranchId = context.BranchId,
            Role     = MessageRole.User,
            Content  = redactedUserText
        };

        foreach (var attachment in context.Attachments.Where(a =>
            a.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)))
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

        // Build assistant message: understanding summary + all images
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
            await imageRepo.AddAsync(r.ImageId, context.BranchId, context.RequestTokenHash, ct);

        await conversationRepo.AddMessageAsync(assistantMessage, ct);
        await conversationRepo.SaveChangesAsync(ct);

        yield return new SmartChatEvent("done", new { messageId = assistantMessage.Id.ToString() });
    }

    // ── Agent 1: Gemma prompt analysis ───────────────────────────────────────

    private async Task<AnalysisResult> AnalyzeAndExpandPromptsAsync(
        string userText, CancellationToken ct)
    {
        // For quoted-prompt lists, tell Gemma to enhance each one
        var quotedPrompts = ExtractQuotedPrompts(userText);
        var analystInput = quotedPrompts.Count > 0
            ? $"Enhance these image prompts:\n" +
              string.Join("\n", quotedPrompts.Select((p, i) => $"{i + 1}. \"{p}\""))
            : userText;

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
                return FallbackResult(quotedPrompts, userText);
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
            using var doc        = JsonDocument.Parse(rawJson);
            var root             = doc.RootElement;
            var understanding    = root.TryGetProperty("understanding", out var u) ? u.GetString() ?? "" : "";
            var promptsElement   = root.GetProperty("prompts");
            var expandedPrompts  = new List<ExpandedPrompt>();

            foreach (var p in promptsElement.EnumerateArray())
            {
                var desc  = p.TryGetProperty("description", out var d) ? d.GetString() ?? "Image" : "Image";
                var flux  = p.TryGetProperty("prompt",      out var f) ? f.GetString() ?? ""      : "";
                if (!string.IsNullOrWhiteSpace(flux))
                    expandedPrompts.Add(new ExpandedPrompt(desc, flux));
            }

            if (expandedPrompts.Count > 0)
                return new AnalysisResult(understanding, expandedPrompts, analystModel);
        }
        catch { /* fall through to fallback */ }

        return FallbackResult(quotedPrompts, userText);
    }

    private static AnalysisResult FallbackResult(List<string> quoted, string userText)
    {
        var prompts = quoted.Count > 0
            ? quoted.Select(p => new ExpandedPrompt("Image", p)).ToList()
            : new List<ExpandedPrompt> { new("Image", userText.Trim()) };

        return new AnalysisResult("(analyst models unavailable — using raw prompts)", prompts, "raw prompt fallback");
    }

    // ── Agent 2: Flux CLI generation ─────────────────────────────────────────

    private static async Task<string> GenerateViaCliAsync(
        string model, string prompt, CancellationToken ct)
    {
        var ollamaBin = ResolveOllamaBinary();
        var workDir   = Path.Combine(Path.GetTempPath(), $"eminentai_flux_{Guid.NewGuid():N}");
        Directory.CreateDirectory(workDir);

        try
        {
            var escapedPrompt = prompt.Replace("\\", "\\\\").Replace("\"", "\\\"");

            var psi = new ProcessStartInfo
            {
                FileName               = ollamaBin,
                Arguments              = $"run {model} \"{escapedPrompt}\"",
                WorkingDirectory       = workDir,
                RedirectStandardOutput = true,
                RedirectStandardError  = true,
                UseShellExecute        = false,
                CreateNoWindow         = true,
            };

            using var process = new Process { StartInfo = psi };
            var stdout = new System.Text.StringBuilder();
            var stderr = new System.Text.StringBuilder();

            process.OutputDataReceived += (_, e) => { if (e.Data != null) stdout.AppendLine(e.Data); };
            process.ErrorDataReceived  += (_, e) => { if (e.Data != null) stderr.AppendLine(e.Data); };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeoutCts.CancelAfter(TimeSpan.FromMinutes(15));
            await process.WaitForExitAsync(timeoutCts.Token);

            if (process.ExitCode != 0)
                throw new InvalidOperationException(
                    $"ollama run exited with code {process.ExitCode}. " +
                    Truncate(stderr.ToString().Trim(), 300));

            // Strategy A: PNG written to working directory
            var pngFiles = Directory.GetFiles(workDir, "*.png");
            if (pngFiles.Length > 0)
            {
                var bytes = await File.ReadAllBytesAsync(pngFiles[0], ct);
                if (IsPng(bytes)) return Convert.ToBase64String(bytes);
            }

            // Strategy B: stdout contains base64-encoded image
            var b64 = ExtractBase64FromOutput(stdout.ToString());
            if (b64 is not null) return b64;

            throw new InvalidOperationException(
                "ollama run produced no recognisable image output. " +
                $"stdout snippet: '{Truncate(stdout.ToString(), 100)}'");
        }
        finally
        {
            try { Directory.Delete(workDir, recursive: true); } catch { /* best-effort */ }
        }
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

        var ext = DetectImageFormat(bytes)
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

    // ── Format helpers ────────────────────────────────────────────────────────

    private static bool IsPng(byte[] b) =>
        b.Length > 8
        && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47
        && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A;

    private static bool IsJpeg(byte[] b) => b.Length > 2 && b[0] == 0xFF && b[1] == 0xD8;

    private static bool IsWebP(byte[] b) =>
        b.Length > 4
        && b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46;

    private static string? DetectImageFormat(byte[] b)
    {
        if (IsPng(b))  return "png";
        if (IsJpeg(b)) return "jpg";
        if (b.Length > 3 && b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46) return "gif";
        if (IsWebP(b)) return "webp";
        return null;
    }

    private static string? ExtractBase64FromOutput(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var stripped = Regex.Replace(raw, @"\x1B\[[0-9;]*[mK]", ""); // strip ANSI
        foreach (Match m in Regex.Matches(stripped, @"[A-Za-z0-9+/]{40,}={0,2}")
                                 .OrderByDescending(x => x.Length))
        {
            var candidate = m.Value;
            var padded    = candidate.Length % 4 == 0
                ? candidate
                : candidate + new string('=', 4 - candidate.Length % 4);
            try
            {
                var bytes = Convert.FromBase64String(padded);
                if (IsPng(bytes) || IsJpeg(bytes) || IsWebP(bytes))
                    return padded;
            }
            catch (FormatException) { }
        }
        return null;
    }

    private static List<string> ExtractQuotedPrompts(string userText)
    {
        var results = new List<string>();
        foreach (Match m in QuotedPromptRegex.Matches(userText))
        {
            var value = m.Groups[1].Value.Trim();
            if (!string.IsNullOrWhiteSpace(value)) results.Add(value);
        }
        return results;
    }

    private static string ResolveOllamaBinary()
    {
        using var check = new Process();
        check.StartInfo = new ProcessStartInfo
        {
            FileName               = OperatingSystem.IsWindows() ? "where" : "which",
            Arguments              = "ollama",
            RedirectStandardOutput = true,
            UseShellExecute        = false,
            CreateNoWindow         = true,
        };
        try
        {
            check.Start();
            var result = check.StandardOutput.ReadLine()?.Trim();
            check.WaitForExit();
            if (!string.IsNullOrEmpty(result) && File.Exists(result)) return result;
        }
        catch { }

        foreach (var p in new[]
        {
            "/Applications/Ollama.app/Contents/Resources/ollama",
            "/usr/local/bin/ollama",
            "/opt/homebrew/bin/ollama",
            "/usr/bin/ollama",
        })
            if (File.Exists(p)) return p;

        return "ollama";
    }

    private static string Truncate(string s, int max) =>
        s.Length <= max ? s : s[..max] + "…";

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
