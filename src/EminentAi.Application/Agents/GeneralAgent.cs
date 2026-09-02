using System.Runtime.CompilerServices;
using EminentAi.Application.Chat;
using EminentAi.Application.Routing;

namespace EminentAi.Application.Agents;

/// <summary>
/// Specialized agent for General tasks.
/// Delegates to ChatService for streaming, persistence, and message ID creation.
/// The done event carries the messageId returned from ChatService — never preallocated.
/// </summary>
public sealed class GeneralAgent(ChatService chatService) : ISpecializedAgent
{
    public AgentKind Kind => AgentKind.General;

    public async IAsyncEnumerable<SmartChatEvent> ExecuteAsync(
        SmartChatContext context,
        ModelRoute route,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var attachments = context.Attachments.ToList();

        Guid? messageId = null;
        int tokensIn = 0, tokensOut = 0;

        // §15 item 1: the intent classifier already generated a full answer in the same call that
        // decided this was General — reuse it instead of a second inference, but only when the
        // resolved route landed on the exact model that generated it.
        var canReusePrehydrated = context.Intent.PrehydratedResponse is not null
            && context.Intent.ClassifierModel.Equals(route.Model.Name, StringComparison.OrdinalIgnoreCase);

        var stream = canReusePrehydrated
            ? chatService.SendPrehydratedMessageAsync(
                context.BranchId,
                context.UserText,
                context.Intent.PrehydratedResponse!,
                route.Model.Name,
                context.Intent.PrehydratedUsage,
                attachments,
                ct)
            : chatService.SendMessageAsync(
                context.BranchId,
                context.UserText,
                modelOverride: route.Model.Name,
                attachments: attachments,
                profile: context.Intent.Profile,
                ct: ct);

        await foreach (var delta in stream)
        {
            if (delta.Token is not null)
                yield return new SmartChatEvent("token", new { text = delta.Token });

            if (delta.MessageId.HasValue)
                messageId = delta.MessageId.Value;

            if (delta.Usage is not null)
            {
                tokensIn = delta.Usage.In ?? 0;
                tokensOut = delta.Usage.Out ?? 0;
            }
        }

        // messageId is set when ChatService persists — always present after stream completes
        yield return new SmartChatEvent("done", new
        {
            messageId = messageId?.ToString(),
            tokensIn,
            tokensOut
        });
    }
}
