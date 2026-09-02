namespace EminentAi.Application.Hardware;

public enum GpuTaskPriority { Normal, High }

/// <summary>
/// Serializes access to the local GPU/VRAM across concurrent smart-chat turns (§18.5.1 of
/// AGENT_2_AGENT_ARCHITECTURE.md). A single local Ollama instance effectively has one execution
/// lane; without this gate, ImageGenerationAgent's VRAM eviction (§6.6) can race with an in-flight
/// text generation on another branch/tab and crash both (§18.2 item 1). <c>priority</c> is honored
/// (§15 item 3): a High-priority waiter is granted the lease ahead of any queued Normal waiter as
/// soon as it frees up.
/// </summary>
public interface IGpuWorkCoordinator
{
    /// <summary>
    /// Waits for exclusive GPU access, then returns a lease. Dispose the lease to release it.
    /// </summary>
    Task<IDisposable> AcquireAsync(
        string targetModel,
        GpuTaskPriority priority = GpuTaskPriority.Normal,
        CancellationToken ct = default);
}
