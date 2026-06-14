using EminentAi.Application.Routing;

namespace EminentAi.Application.Agents;

public interface ISpecializedAgent
{
    AgentKind Kind { get; }

    /// <summary>
    /// Executes the agent turn. Must persist the message before yielding done.
    /// The messageId carried by done is the ID returned from ChatService, not preallocated.
    /// </summary>
    IAsyncEnumerable<SmartChatEvent> ExecuteAsync(
        SmartChatContext context,
        ModelRoute route,
        CancellationToken ct);
}
