using EminentAi.Application.Chat;
using EminentAi.Application.Routing;

namespace EminentAi.Application.Agents;

/// <summary>
/// Context passed to every ISpecializedAgent.ExecuteAsync.
/// AssistantMessageId is intentionally absent — ChatService owns message creation
/// and returns the ID, which is then carried by the done SSE event.
/// </summary>
public sealed record SmartChatContext(
    Guid BranchId,
    string UserText,
    IReadOnlyList<ChatAttachment> Attachments,
    IntentDecision Intent,
    string? RequestTokenHash
);
