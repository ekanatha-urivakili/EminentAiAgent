using System.Runtime.CompilerServices;
using EminentAi.Application.Abstractions;
using EminentAi.Application.Providers;
using Microsoft.Extensions.Logging;

namespace EminentAi.Infrastructure.Providers;

/// <summary>
/// IModelProvider implementation wrapping OllamaClient.
/// All Ollama models are local, zero-cost, and have no region restriction.
/// Model list is cached for 30 seconds; a SemaphoreSlim prevents stampede on expiry.
/// </summary>
public sealed class OllamaModelProvider(
    IOllamaClient client,
    ILogger<OllamaModelProvider> logger) : IModelProvider
{
    private const string ProviderName = "ollama";
    private static readonly TimeSpan CacheExpiry = TimeSpan.FromSeconds(30);

    private readonly SemaphoreSlim _cacheLock = new(1, 1);
    private volatile IReadOnlyList<ModelDescriptor>? _cachedDescriptors;
    // Use long ticks + Volatile.Read/Write for cross-platform atomic access (ARM-safe)
    private long _cacheExpiresAtTicks = DateTime.MinValue.Ticks;

    public string Name => ProviderName;

    public async Task<IReadOnlyList<ModelDescriptor>> ListModelsAsync(CancellationToken ct = default)
    {
        // Fast path: serve cached value without taking the lock
        var cached = _cachedDescriptors;
        if (cached is not null && DateTime.UtcNow.Ticks < Volatile.Read(ref _cacheExpiresAtTicks))
            return cached;

        await _cacheLock.WaitAsync(ct);
        try
        {
            // Re-check under lock (another thread may have refreshed while we waited)
            cached = _cachedDescriptors;
            if (cached is not null && DateTime.UtcNow.Ticks < Volatile.Read(ref _cacheExpiresAtTicks))
                return cached;

            var models = await client.ListModelsAsync(ct);
            var descriptors = models.Select(MapDescriptor).ToList().AsReadOnly();
            _cachedDescriptors = descriptors;
            Volatile.Write(ref _cacheExpiresAtTicks, (DateTime.UtcNow + CacheExpiry).Ticks);
            return descriptors;
        }
        finally
        {
            _cacheLock.Release();
        }
    }

    public async IAsyncEnumerable<ChatDelta> StreamAsync(
        ModelInvocation invocation,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var request = new ChatRequest(
            invocation.ModelName,
            invocation.Messages,
            Temperature: invocation.Profile.Temperature,
            ContextWindow: 8192
        );

        await foreach (var delta in client.ChatStreamAsync(request, ct))
            yield return delta;
    }

    public async Task<ProviderHealth> CheckHealthAsync(CancellationToken ct = default)
    {
        try
        {
            var healthy = await client.IsHealthyAsync(ct);
            return new ProviderHealth(
                ProviderName,
                healthy,
                healthy ? null : "Ollama /api/tags returned non-2xx",
                DateTime.UtcNow);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Ollama health check failed");
            return new ProviderHealth(ProviderName, false, ex.Message, DateTime.UtcNow);
        }
    }

    private static ModelDescriptor MapDescriptor(ModelInfo m) => new(
        Name: m.Name,
        ProviderName: ProviderName,
        Capabilities: MapCapabilities(m.Tier),
        SizeBytes: m.SizeBytes,
        Tier: m.Tier,
        IsAvailable: true,
        IsLocal: true,
        Region: null,
        InputTokenCostUsd: 0m,
        OutputTokenCostUsd: 0m
    );

    private static IReadOnlySet<ModelCapability> MapCapabilities(string tier) => tier switch
    {
        "vision"    => new HashSet<ModelCapability> { ModelCapability.Vision, ModelCapability.TextGeneration },
        "fast"      => new HashSet<ModelCapability> { ModelCapability.TextGeneration, ModelCapability.CodeGeneration },
        "balanced"  => new HashSet<ModelCapability> { ModelCapability.TextGeneration, ModelCapability.CodeGeneration, ModelCapability.FunctionCalling },
        "reasoning" => new HashSet<ModelCapability> { ModelCapability.TextGeneration, ModelCapability.Reasoning },
        "embedding" => new HashSet<ModelCapability> { ModelCapability.Embedding },
        "image_gen" => new HashSet<ModelCapability> { ModelCapability.ImageGeneration },
        _           => new HashSet<ModelCapability> { ModelCapability.TextGeneration }
    };
}
