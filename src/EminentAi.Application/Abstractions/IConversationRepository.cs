using EminentAi.Domain;

namespace EminentAi.Application.Abstractions;

public interface IConversationRepository
{
    Task<List<Conversation>> ListConversationsAsync(CancellationToken ct = default);
    Task<Conversation?> GetConversationAsync(Guid id, CancellationToken ct = default);
    Task AddConversationAsync(Conversation conversation, CancellationToken ct = default);
    Task DeleteConversationAsync(Guid id, CancellationToken ct = default);

    Task<Branch?> GetBranchAsync(Guid id, CancellationToken ct = default);
    Task AddBranchAsync(Branch branch, CancellationToken ct = default);

    Task<Message?> GetMessageAsync(Guid id, CancellationToken ct = default);
    Task AddMessageAsync(Message message, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
}
