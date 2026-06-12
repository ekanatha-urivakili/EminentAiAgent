using System.Runtime.CompilerServices;
using LocalForge.Application.Abstractions;
using LocalForge.Domain;

namespace LocalForge.Application.Chat;

public class ChatService(IConversationRepository repo, IOllamaClient ollama, IPiiRedactor redactor)
{
    public async Task<Conversation> CreateConversationAsync(
        string title, string model, string? systemPrompt = null, CancellationToken ct = default)
    {
        var conversation = new Conversation
        {
            Title = string.IsNullOrWhiteSpace(title) ? "New chat" : title.Trim(),
            ModelDefault = model,
            SystemPrompt = systemPrompt ?? "You are LocalForge, a helpful AI assistant running fully locally."
        };
        var branch = new Branch { ConversationId = conversation.Id };

        await repo.AddConversationAsync(conversation, ct);
        await repo.AddBranchAsync(branch, ct);
        await repo.SaveChangesAsync(ct);
        return conversation;
    }

    public async Task<Branch> BranchConversationAsync(Guid branchId, Guid messageId, CancellationToken ct = default)
    {
        var sourceBranch = await repo.GetBranchAsync(branchId, ct)
            ?? throw new KeyNotFoundException("Branch not found");

        var ordered = sourceBranch.Messages.OrderBy(m => m.CreatedAt).ToList();
        var cutoff = ordered.FindIndex(m => m.Id == messageId);
        if (cutoff < 0) throw new KeyNotFoundException("Message not found in branch");

        var newBranch = new Branch
        {
            ConversationId = sourceBranch.ConversationId,
            ParentBranchId = branchId
        };
        foreach (var msg in ordered.Take(cutoff + 1))
        {
            newBranch.Messages.Add(new Message
            {
                BranchId = newBranch.Id,
                Role = msg.Role,
                Content = msg.Content,
                Model = msg.Model,
                CreatedAt = msg.CreatedAt,
                ParentMessageId = msg.ParentMessageId
            });
        }

        await repo.AddBranchAsync(newBranch, ct);
        await repo.SaveChangesAsync(ct);
        return newBranch;
    }

    public async IAsyncEnumerable<ChatDelta> SendMessageAsync(
        Guid branchId, string content, string? modelOverride = null, List<ChatAttachment>? attachments = null,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var branch = await repo.GetBranchAsync(branchId, ct)
            ?? throw new KeyNotFoundException("Branch not found");

        var history = branch.Messages.OrderBy(m => m.CreatedAt).ToList();
        var redacted = redactor.Redact(content);
        var imageAttachments = (attachments ?? new List<ChatAttachment>())
            .Where(a => a.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            .ToList();

        var userMessage = new Message
        {
            BranchId = branchId,
            Role = MessageRole.User,
            Content = redacted
        };
        foreach (var attachment in imageAttachments)
        {
            userMessage.Attachments.Add(new MessageAttachment
            {
                MessageId = userMessage.Id,
                Name = attachment.Name,
                ContentType = attachment.ContentType,
                DataBase64 = attachment.DataBase64
            });
        }
        await repo.AddMessageAsync(userMessage, ct);

        // Auto-title: first user message names the conversation.
        if (history.Count == 0 && branch.Conversation is not null &&
            (string.IsNullOrWhiteSpace(branch.Conversation.Title) || branch.Conversation.Title == "New chat"))
        {
            branch.Conversation.Title = redacted.Length > 60 ? redacted[..60] + "…" : redacted;
        }
        await repo.SaveChangesAsync(ct);

        var model = modelOverride ?? branch.Conversation!.ModelDefault;
        var messages = BuildContext(branch.Conversation!.SystemPrompt, history);
        messages.Add(new ChatMessage("user", redacted, imageAttachments.Select(a => a.DataBase64).ToList()));

        await foreach (var delta in StreamAndPersistAsync(branchId, userMessage.Id, model, messages, ct))
            yield return delta;
    }

    /// <summary>Regenerate is non-destructive: the new reply is a sibling sharing ParentMessageId.</summary>
    public async IAsyncEnumerable<ChatDelta> RegenerateAsync(
        Guid messageId, string? modelOverride = null, float? temperature = null,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var original = await repo.GetMessageAsync(messageId, ct)
            ?? throw new KeyNotFoundException("Message not found");
        if (original.Role != MessageRole.Assistant)
            throw new InvalidOperationException("Only assistant messages can be regenerated");

        var branch = await repo.GetBranchAsync(original.BranchId, ct)
            ?? throw new KeyNotFoundException("Branch not found");

        // Context = everything strictly before the original assistant reply.
        var history = branch.Messages
            .OrderBy(m => m.CreatedAt)
            .TakeWhile(m => m.Id != messageId)
            .ToList();

        var model = modelOverride ?? original.Model ?? branch.Conversation!.ModelDefault;
        var messages = BuildContext(branch.Conversation!.SystemPrompt, history);

        await foreach (var delta in StreamAndPersistAsync(
            branch.Id, original.ParentMessageId, model, messages, ct, temperature))
            yield return delta;
    }

    private static List<ChatMessage> BuildContext(string systemPrompt, List<Message> history)
    {
        var messages = new List<ChatMessage>();
        if (!string.IsNullOrEmpty(systemPrompt))
            messages.Add(new ChatMessage("system", systemPrompt));
        foreach (var msg in history.Where(m => m.Role is MessageRole.User or MessageRole.Assistant))
            messages.Add(new ChatMessage(
                msg.Role == MessageRole.User ? "user" : "assistant",
                msg.Content,
                msg.Attachments.Count > 0 ? msg.Attachments.Select(a => a.DataBase64).ToList() : null));
        return messages;
    }

    private async IAsyncEnumerable<ChatDelta> StreamAndPersistAsync(
        Guid branchId, Guid? parentMessageId, string model, List<ChatMessage> messages,
        [EnumeratorCancellation] CancellationToken ct, float? temperature = null)
    {
        var assistantMessage = new Message
        {
            BranchId = branchId,
            Role = MessageRole.Assistant,
            Model = model,
            ParentMessageId = parentMessageId
        };

        var started = DateTime.UtcNow;
        var fullContent = "";
        Usage? usage = null;

        var request = new ChatRequest(model, messages, Temperature: temperature);
        var stream = ollama.ChatStreamAsync(request, ct);
        await using var enumerator = stream.GetAsyncEnumerator(CancellationToken.None);
        while (true)
        {
            ChatDelta delta;
            try
            {
                if (!await enumerator.MoveNextAsync()) break;
                delta = enumerator.Current;
            }
            catch (OperationCanceledException) { break; }   // client went away — keep partial content

            if (delta.Token is not null) fullContent += delta.Token;
            if (delta.Done) usage = delta.Usage;
            yield return delta with { MessageId = assistantMessage.Id };
        }

        // Persist whatever we got, even if the stream ended early.
        assistantMessage.Content = fullContent;
        assistantMessage.TokensIn = usage?.In;
        assistantMessage.TokensOut = usage?.Out;
        assistantMessage.LatencyMs = (long)(DateTime.UtcNow - started).TotalMilliseconds;
        await repo.AddMessageAsync(assistantMessage, CancellationToken.None);
        await repo.SaveChangesAsync(CancellationToken.None);
    }
}

public record ChatAttachment(string Name, string ContentType, string DataBase64);
