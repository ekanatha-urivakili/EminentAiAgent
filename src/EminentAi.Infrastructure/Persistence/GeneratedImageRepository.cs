using EminentAi.Application.Abstractions;
using EminentAi.Domain;
using Microsoft.EntityFrameworkCore;

namespace EminentAi.Infrastructure.Persistence;

public sealed class GeneratedImageRepository(IDbContextFactory<EminentAiDbContext> dbFactory) : IGeneratedImageRepository
{
    public async Task AddAsync(Guid imageId, Guid branchId, string? sessionTokenHash, CancellationToken ct = default)
    {
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        db.GeneratedImages.Add(new GeneratedImage
        {
            Id = imageId,
            BranchId = branchId,
            SessionTokenHash = sessionTokenHash,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync(ct);
    }

    public async Task<bool> ExistsForSessionAsync(Guid imageId, string? sessionTokenHash, CancellationToken ct = default)
    {
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        return await db.GeneratedImages.AnyAsync(g =>
            g.Id == imageId && g.SessionTokenHash == sessionTokenHash, ct);
    }
}
