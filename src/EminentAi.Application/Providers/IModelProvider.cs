using EminentAi.Application.Abstractions;

namespace EminentAi.Application.Providers;

public interface IModelProvider
{
    string Name { get; }
    Task<IReadOnlyList<ModelDescriptor>> ListModelsAsync(CancellationToken ct = default);
    IAsyncEnumerable<ChatDelta> StreamAsync(ModelInvocation invocation, CancellationToken ct = default);
    Task<ProviderHealth> CheckHealthAsync(CancellationToken ct = default);
}
