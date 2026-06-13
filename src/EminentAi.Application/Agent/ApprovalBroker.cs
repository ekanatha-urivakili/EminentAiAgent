using System.Collections.Concurrent;

namespace EminentAi.Application.Agent;

public record ApprovalDecision(bool Approved, bool Remember);

/// <summary>
/// Bridges the agent loop (waiting inside an SSE response) with approval decisions that
/// arrive on a separate HTTP request. Singleton. Also tracks per-run cancellation.
/// </summary>
public sealed class ApprovalBroker
{
    private readonly ConcurrentDictionary<(Guid RunId, Guid StepId), TaskCompletionSource<ApprovalDecision>> _pending = new();
    private readonly ConcurrentDictionary<Guid, CancellationTokenSource> _runs = new();

    public CancellationTokenSource RegisterRun(Guid runId, CancellationToken upstream)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(upstream);
        _runs[runId] = cts;
        return cts;
    }

    public void CompleteRun(Guid runId)
    {
        if (_runs.TryRemove(runId, out var cts)) cts.Dispose();
        foreach (var key in _pending.Keys)
        {
            if (key.RunId == runId && _pending.TryRemove(key, out var tcs))
                tcs.TrySetCanceled();
        }
    }

    public bool CancelRun(Guid runId)
    {
        if (!_runs.TryGetValue(runId, out var cts)) return false;
        cts.Cancel();
        return true;
    }

    public async Task<ApprovalDecision> WaitForDecisionAsync(Guid runId, Guid stepId, TimeSpan timeout, CancellationToken ct)
    {
        var tcs = new TaskCompletionSource<ApprovalDecision>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[(runId, stepId)] = tcs;
        try
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeoutCts.CancelAfter(timeout);
            await using var reg = timeoutCts.Token.Register(() => tcs.TrySetResult(new ApprovalDecision(false, false)));
            return await tcs.Task.ConfigureAwait(false);
        }
        finally
        {
            _pending.TryRemove((runId, stepId), out _);
        }
    }

    public bool Resolve(Guid runId, Guid stepId, ApprovalDecision decision)
        => _pending.TryGetValue((runId, stepId), out var tcs) && tcs.TrySetResult(decision);
}
