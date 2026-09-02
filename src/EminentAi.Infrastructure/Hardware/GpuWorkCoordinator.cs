using EminentAi.Application.Hardware;

namespace EminentAi.Infrastructure.Hardware;

/// <summary>
/// Single-lane exclusive gate around every smart-chat turn that touches the local GPU. Per §18.5.1,
/// the lease itself stays strictly single-holder. §15 item 3 adds real priority ordering on top of
/// that: a <see cref="GpuTaskPriority.High"/> waiter is handed the lease ahead of any queued
/// <see cref="GpuTaskPriority.Normal"/> waiter as soon as it's free, so a short text turn can skip
/// ahead of a long-running image generation instead of waiting strict FIFO. Ordering within a
/// priority tier is still FIFO.
/// </summary>
public sealed class GpuWorkCoordinator : IGpuWorkCoordinator
{
    private readonly object _gate = new();
    private bool _held;
    private readonly Queue<TaskCompletionSource<bool>> _highPriorityWaiters = new();
    private readonly Queue<TaskCompletionSource<bool>> _normalPriorityWaiters = new();

    public async Task<IDisposable> AcquireAsync(
        string targetModel,
        GpuTaskPriority priority = GpuTaskPriority.Normal,
        CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();

        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        lock (_gate)
        {
            if (!_held)
            {
                _held = true;
                tcs.SetResult(true);
            }
            else
            {
                var queue = priority == GpuTaskPriority.High ? _highPriorityWaiters : _normalPriorityWaiters;
                queue.Enqueue(tcs);
            }
        }

        using var registration = ct.Register(() => tcs.TrySetCanceled(ct));
        await tcs.Task.ConfigureAwait(false);
        return new Releaser(this);
    }

    /// <summary>
    /// Hands the lease directly to the next waiter (high-priority queue first) instead of releasing
    /// it back to a fair semaphore — this is what makes priority ordering real rather than advisory.
    /// A waiter that cancelled while queued is skipped; <c>_held</c> only drops to false once both
    /// queues are exhausted.
    /// </summary>
    private void Release()
    {
        lock (_gate)
        {
            while (true)
            {
                var next = _highPriorityWaiters.Count > 0 ? _highPriorityWaiters.Dequeue()
                    : _normalPriorityWaiters.Count > 0 ? _normalPriorityWaiters.Dequeue()
                    : null;

                if (next is null)
                {
                    _held = false;
                    return;
                }

                if (next.TrySetResult(true))
                    return;
            }
        }
    }

    private sealed class Releaser(GpuWorkCoordinator owner) : IDisposable
    {
        private int _released;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0)
                owner.Release();
        }
    }
}
