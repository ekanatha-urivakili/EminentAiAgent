using EminentAi.Application.Abstractions;
using EminentAi.Domain;
using Microsoft.EntityFrameworkCore;

namespace EminentAi.Infrastructure.Persistence;

/// <summary>
/// Uses a DbContext factory because the agent loop outlives normal request scopes and
/// writes from inside a long-running SSE response.
/// </summary>
public class AgentRunRepository(IDbContextFactory<EminentAiDbContext> dbFactory) : IAgentRunRepository
{
    public async Task AddRunAsync(AgentRun run, CancellationToken ct = default)
    {
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        db.AgentRuns.Add(run);
        await db.SaveChangesAsync(ct);
    }

    public async Task AddStepAsync(AgentStep step, CancellationToken ct = default)
    {
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        db.AgentSteps.Add(step);
        await db.SaveChangesAsync(ct);
    }

    public async Task UpdateStepAsync(AgentStep step, CancellationToken ct = default)
    {
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        var existing = await db.AgentSteps.FirstOrDefaultAsync(s => s.Id == step.Id, ct);
        if (existing is null) return;
        existing.Status = step.Status;
        existing.ResultJson = step.ResultJson;
        await db.SaveChangesAsync(ct);
    }

    public async Task UpdateRunAsync(AgentRun run, CancellationToken ct = default)
    {
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        var existing = await db.AgentRuns.FirstOrDefaultAsync(r => r.Id == run.Id, ct);
        if (existing is null) return;
        existing.Status = run.Status;
        existing.FinishedAt = run.FinishedAt;
        existing.FinalAnswer = run.FinalAnswer;
        await db.SaveChangesAsync(ct);
    }

    public async Task<AgentRun?> GetRunAsync(Guid id, CancellationToken ct = default)
    {
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        return await db.AgentRuns
            .Include(r => r.Steps.OrderBy(s => s.Ordinal))
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == id, ct);
    }
}
