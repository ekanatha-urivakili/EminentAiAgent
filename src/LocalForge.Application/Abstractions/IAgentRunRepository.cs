using LocalForge.Domain;

namespace LocalForge.Application.Abstractions;

public interface IAgentRunRepository
{
    Task AddRunAsync(AgentRun run, CancellationToken ct = default);
    Task AddStepAsync(AgentStep step, CancellationToken ct = default);
    Task UpdateStepAsync(AgentStep step, CancellationToken ct = default);
    Task UpdateRunAsync(AgentRun run, CancellationToken ct = default);
    Task<AgentRun?> GetRunAsync(Guid id, CancellationToken ct = default);
}
