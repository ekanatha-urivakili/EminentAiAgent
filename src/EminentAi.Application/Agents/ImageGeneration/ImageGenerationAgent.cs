using System.Diagnostics;
using System.Runtime.CompilerServices;
using EminentAi.Application.Abstractions;
using EminentAi.Application.Chat;
using EminentAi.Application.Routing;
using EminentAi.Domain;

namespace EminentAi.Application.Agents.ImageGeneration;

/// <summary>
/// Handles image generation via Flux2 (flux2-klein:4b).
/// Pipeline: translate user prompt → Flux prompt → generate PNG → persist → done.
/// Both GeneratedImages and Message rows are written BEFORE the done SSE is yielded.
///
/// Depends only on Application-layer abstractions — no Infrastructure references.
///
/// IMPORTANT: Only activate after the Flux spike confirms response shape:
///   curl http://127.0.0.1:11434/api/generate \
///     -d '{"model":"x/flux2-klein:4b","prompt":"test","stream":false}'
///   Expected: { "response": "<base64 PNG string>" }
/// </summary>
public sealed class ImageGenerationAgent(
    IOllamaClient ollama,
    IGeneratedImageRepository imageRepo,
    IConversationRepository conversationRepo,
    IPiiRedactor redactor,
    string outputDirectory) : ISpecializedAgent
{
    private const string TranslatorModel = "qwen3.5:2b";

    private static readonly string FluxTranslationPromptTemplate = """
        You are a Flux2 image prompt engineer. Convert the user's description into
        a comma-separated keyword list of 10–20 terms describing the image visually.

        Rules:
        - Visual attributes only: style, colours, mood, composition, medium.
        - Art style keywords: vector, digital art, photorealistic, minimalist.
        - Quality boosters when relevant: high detail, sharp, professional.
        - No negatives — Flux uses a separate negative_prompt field.
        - Output ONLY the prompt string. No quotes, no explanation, no prefix.

        User request:
        """;

    public AgentKind Kind => AgentKind.ImageGeneration;

    public async IAsyncEnumerable<SmartChatEvent> ExecuteAsync(
        SmartChatContext context,
        ModelRoute route,
        [EnumeratorCancellation] CancellationToken ct)
    {
        // Stage 1 — translate
        yield return new SmartChatEvent("image_gen_progress", new { stage = "translating" });
        var fluxPrompt = await TranslateToFluxPromptAsync(context.UserText, ct);

        // Stage 2 — generate (VRAM swap can happen here; SSE fires before swap begins)
        yield return new SmartChatEvent("image_gen_progress", new { stage = "generating", fluxPrompt });

        var sw = Stopwatch.StartNew();
        string base64Png;
        string? generationError = null;
        try
        {
            base64Png = await ollama.GenerateImageAsync(route.Model.Name, fluxPrompt, ct);
        }
        catch (Exception ex)
        {
            base64Png = "";
            generationError = $"Image generation failed for model {route.Model.Name}: {ex.Message}";
        }
        if (generationError is not null)
        {
            yield return new SmartChatEvent("routing_error", new
            {
                intent = "imageGeneration",
                message = generationError
            });
            yield break;
        }
        sw.Stop();

        // Stage 3 — save to filesystem
        yield return new SmartChatEvent("image_gen_progress", new { stage = "saving" });

        string filename;
        string? saveError = null;
        try
        {
            (_, filename) = await SaveImageAsync(base64Png, ct);
        }
        catch (Exception ex)
        {
            filename = "";
            saveError = $"Failed to save generated image: {ex.Message}";
        }
        if (saveError is not null)
        {
            yield return new SmartChatEvent("routing_error", new
            {
                intent = "imageGeneration",
                message = saveError
            });
            yield break;
        }

        var imageId = Guid.Parse(Path.GetFileNameWithoutExtension(filename));
        var imageUrl = $"/api/generated-images/{filename}";

        var redactedUserText = redactor.Redact(context.UserText);
        var redactedFluxPrompt = redactor.Redact(fluxPrompt);

        var userMessage = new Message
        {
            BranchId = context.BranchId,
            Role = MessageRole.User,
            Content = redactedUserText
        };

        foreach (var attachment in context.Attachments.Where(a =>
            a.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)))
        {
            userMessage.Attachments.Add(new MessageAttachment
            {
                MessageId = userMessage.Id,
                Name = attachment.Name,
                ContentType = attachment.ContentType,
                DataBase64 = attachment.DataBase64
            });
        }

        await conversationRepo.AddMessageAsync(userMessage, ct);
        await conversationRepo.SaveChangesAsync(ct);

        // Persist ownership record + assistant message (both before done)
        await imageRepo.AddAsync(imageId, context.BranchId, context.RequestTokenHash, ct);

        var messageContent = $"![Generated image]({imageUrl})\n\n*Flux prompt: {redactedFluxPrompt}*";
        var assistantMessage = new Message
        {
            BranchId = context.BranchId,
            Role = MessageRole.Assistant,
            Content = messageContent,
            Model = route.Model.Name,
            ParentMessageId = userMessage.Id
        };
        await conversationRepo.AddMessageAsync(assistantMessage, ct);
        await conversationRepo.SaveChangesAsync(ct);

        yield return new SmartChatEvent("image_generated", new
        {
            url = imageUrl,
            filename,
            fluxPrompt = redactedFluxPrompt,
            generationMs = sw.ElapsedMilliseconds
        });

        yield return new SmartChatEvent("done", new { messageId = assistantMessage.Id.ToString() });
    }

    private async Task<string> TranslateToFluxPromptAsync(string userPrompt, CancellationToken ct)
    {
        var request = new ChatRequest(
            TranslatorModel,
            new List<ChatMessage> { new("user", $"{FluxTranslationPromptTemplate}{userPrompt}") },
            Temperature: 0.3f,
            ContextWindow: 512);

        try
        {
            return await ollama.ChatOnceAsync(request, ct);
        }
        catch
        {
            return userPrompt;
        }
    }

    private async Task<(string FullPath, string Filename)> SaveImageAsync(string base64Raw, CancellationToken ct)
    {
        Directory.CreateDirectory(outputDirectory);

        // Strip data-URL prefix if the model returns "data:image/png;base64,..."
        var base64 = base64Raw.Contains(',')
            ? base64Raw[(base64Raw.IndexOf(',') + 1)..]
            : base64Raw;

        // Flux models often chunk base64 with MIME newlines every 76 chars; strip all whitespace
        base64 = base64.Replace("\r", "").Replace("\n", "").Replace(" ", "").Trim();

        if (base64.Length == 0)
            throw new InvalidOperationException("Model returned an empty image response.");

        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(base64);
        }
        catch (FormatException ex)
        {
            throw new InvalidOperationException(
                $"Model response is not valid base64 (first 40 chars: '{base64[..Math.Min(40, base64.Length)]}'). {ex.Message}", ex);
        }

        var ext = DetectImageFormat(bytes)
            ?? throw new InvalidOperationException(
                $"Model returned bytes that are not a recognised image format (magic: {string.Join(" ", bytes.Take(4).Select(b => b.ToString("X2")))}).");

        var filename = $"{Guid.NewGuid()}.{ext}";
        var fullPath = Path.GetFullPath(Path.Combine(outputDirectory, filename));

        var safeRoot = outputDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                        + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(safeRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Generated image path escapes output directory: {fullPath}");

        await File.WriteAllBytesAsync(fullPath, bytes, ct);
        return (fullPath, filename);
    }

    // Returns "png", "jpg", or null if unrecognised
    private static string? DetectImageFormat(byte[] bytes)
    {
        if (bytes.Length > 8
            && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47
            && bytes[4] == 0x0D && bytes[5] == 0x0A && bytes[6] == 0x1A && bytes[7] == 0x0A)
            return "png";

        if (bytes.Length > 2 && bytes[0] == 0xFF && bytes[1] == 0xD8)
            return "jpg";

        if (bytes.Length > 3
            && bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46)
            return "gif";

        if (bytes.Length > 4
            && bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46)
            return "webp";

        return null;
    }
}
