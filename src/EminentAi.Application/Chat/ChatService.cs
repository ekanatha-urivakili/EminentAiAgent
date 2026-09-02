using System.Runtime.CompilerServices;
using System.Text;
using EminentAi.Application.Abstractions;
using EminentAi.Application.Agents;
using EminentAi.Domain;

namespace EminentAi.Application.Chat;

public class ChatService(IConversationRepository repo, IOllamaClient ollama, IPiiRedactor redactor)
{
    public async Task<Conversation> CreateConversationAsync(
        string title, string model, string? systemPrompt = null, CancellationToken ct = default)
    {
        var conversation = new Conversation
        {
            Title = string.IsNullOrWhiteSpace(title) ? "New chat" : title.Trim(),
            ModelDefault = model,
            SystemPrompt = systemPrompt ?? "You are EminentAi, a helpful AI assistant running fully locally."
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
        AgentProfile? profile = null,
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
        var systemPrompt = profile?.SystemPrompt ?? branch.Conversation!.SystemPrompt;
        var messages = BuildContext(systemPrompt, history);
        messages.Add(new ChatMessage("user", redacted, imageAttachments.Select(a => a.DataBase64).ToList()));

        await foreach (var delta in StreamAndPersistAsync(branchId, userMessage.Id, model, messages, ct))
            yield return delta;
    }

    /// <summary>
    /// Persists a turn whose assistant content was already generated elsewhere (§15 item 1 of
    /// AGENT_2_AGENT_ARCHITECTURE.md: the intent classifier's own tool-calling round-trip doubled
    /// as the final General answer). Skips the model call entirely — the caller is responsible for
    /// having verified the content came from the same model this turn will be attributed to.
    /// </summary>
    public async IAsyncEnumerable<ChatDelta> SendPrehydratedMessageAsync(
        Guid branchId, string userContent, string assistantContent, string model, Usage? usage,
        List<ChatAttachment>? attachments = null,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var branch = await repo.GetBranchAsync(branchId, ct)
            ?? throw new KeyNotFoundException("Branch not found");

        var history = branch.Messages.OrderBy(m => m.CreatedAt).ToList();
        var redactedUser = redactor.Redact(userContent);
        var redactedAssistant = redactor.Redact(assistantContent);
        var imageAttachments = (attachments ?? new List<ChatAttachment>())
            .Where(a => a.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            .ToList();

        var userMessage = new Message
        {
            BranchId = branchId,
            Role = MessageRole.User,
            Content = redactedUser
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

        if (history.Count == 0 && branch.Conversation is not null &&
            (string.IsNullOrWhiteSpace(branch.Conversation.Title) || branch.Conversation.Title == "New chat"))
        {
            branch.Conversation.Title = redactedUser.Length > 60 ? redactedUser[..60] + "…" : redactedUser;
        }

        var assistantMessage = new Message
        {
            BranchId = branchId,
            Role = MessageRole.Assistant,
            Model = model,
            Content = redactedAssistant,
            TokensIn = usage?.In,
            TokensOut = usage?.Out,
            LatencyMs = 0
        };
        await repo.AddMessageAsync(assistantMessage, ct);
        await repo.SaveChangesAsync(ct);

        yield return new ChatDelta(Token: redactedAssistant, MessageId: assistantMessage.Id);
        yield return new ChatDelta(Done: true, Usage: usage, MessageId: assistantMessage.Id);
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
        var fullContent = new StringBuilder();
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

            if (delta.Token is not null) fullContent.Append(delta.Token);
            if (delta.Done) usage = delta.Usage;
            yield return delta with { MessageId = assistantMessage.Id };
        }

        // Persist whatever we got, even if the stream ended early.
        assistantMessage.Content = fullContent.ToString();
        assistantMessage.TokensIn = usage?.In;
        assistantMessage.TokensOut = usage?.Out;
        assistantMessage.LatencyMs = (long)(DateTime.UtcNow - started).TotalMilliseconds;
        await repo.AddMessageAsync(assistantMessage, CancellationToken.None);
        await repo.SaveChangesAsync(CancellationToken.None);
    }
}

public record ChatAttachment(string Name, string ContentType, string DataBase64);
