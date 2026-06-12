using LocalForge.Application.Abstractions;
using LocalForge.Domain;
using Microsoft.EntityFrameworkCore;

namespace LocalForge.Infrastructure.Persistence;

public class ConversationRepository(LocalForgeDbContext db) : IConversationRepository
{
    public Task<List<Conversation>> ListConversationsAsync(CancellationToken ct = default) =>
        db.Conversations
            .AsNoTracking()
            .OrderByDescending(c => c.CreatedAt)
            .ToListAsync(ct);

    public Task<Conversation?> GetConversationAsync(Guid id, CancellationToken ct = default) =>
        db.Conversations
            .Include(c => c.Branches)
            .ThenInclude(b => b.Messages)
            .ThenInclude(m => m.Attachments)
            .AsSplitQuery()
            .FirstOrDefaultAsync(c => c.Id == id, ct);

    public async Task AddConversationAsync(Conversation conversation, CancellationToken ct = default) =>
        await db.Conversations.AddAsync(conversation, ct);

    public async Task DeleteConversationAsync(Guid id, CancellationToken ct = default)
    {
        var conversation = await db.Conversations.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (conversation is not null) db.Conversations.Remove(conversation);
    }

    public Task<Branch?> GetBranchAsync(Guid id, CancellationToken ct = default) =>
        db.Branches
            .Include(b => b.Conversation)
            .Include(b => b.Messages)
            .ThenInclude(m => m.Attachments)
            .AsSplitQuery()
            .FirstOrDefaultAsync(b => b.Id == id, ct);

    public async Task AddBranchAsync(Branch branch, CancellationToken ct = default) =>
        await db.Branches.AddAsync(branch, ct);

    public Task<Message?> GetMessageAsync(Guid id, CancellationToken ct = default) =>
        db.Messages.Include(m => m.Attachments).FirstOrDefaultAsync(m => m.Id == id, ct);

    public async Task AddMessageAsync(Message message, CancellationToken ct = default) =>
        await db.Messages.AddAsync(message, ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
