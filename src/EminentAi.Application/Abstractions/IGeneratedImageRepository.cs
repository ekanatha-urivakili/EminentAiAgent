namespace EminentAi.Application.Abstractions;

/// <summary>
/// Persistence contract for generated image ownership records.
/// Application layer depends on this; Infrastructure implements it.
/// </summary>
public interface IGeneratedImageRepository
{
    Task AddAsync(Guid imageId, Guid branchId, string? sessionTokenHash, CancellationToken ct = default);
    Task<bool> ExistsForSessionAsync(Guid imageId, string? sessionTokenHash, CancellationToken ct = default);
}
