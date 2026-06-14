namespace EminentAi.Application.Routing;

public interface IIntentRouter
{
    Task<IntentDecision> ClassifyAsync(IntentRequest request, CancellationToken ct = default);
}
