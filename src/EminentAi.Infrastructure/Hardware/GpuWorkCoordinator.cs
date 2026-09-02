using EminentAi.Application.Hardware;

namespace EminentAi.Infrastructure.Hardware;

/// <summary>
/// Single-lane semaphore gate around every smart-chat turn that touches the local GPU. Per §18.5.1:
/// for a single-user local workstation, a plain SemaphoreSlim(1,1) is the whole requirement — a real
/// priority queue is not needed until multi-user/concurrent-session support is a stated goal, so
/// <see cref="GpuTaskPriority"/> is accepted but not yet used to reorder waiters.
/// </summary>
public sealed class GpuWorkCoordinator : IGpuWorkCoordinator
{
    private readonly SemaphoreSlim _lock = new(1, 1);

    public async Task<IDisposable> AcquireAsync(
        string targetModel,
        GpuTaskPriority priority = GpuTaskPriority.Normal,
        CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        return new Releaser(_lock);
    }

    private sealed class Releaser(SemaphoreSlim sem) : IDisposable
    {
        private int _released;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0)
                sem.Release();
        }
    }
}
