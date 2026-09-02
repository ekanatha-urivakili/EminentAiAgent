using System.Text.Json.Nodes;

namespace EminentAi.Application.Abstractions;

public record ChatRequest(
    string Model,
    List<ChatMessage> Messages,
    float? Temperature = null,
    int? ContextWindow = null,
    bool ForceJson = false,
    List<ToolSchema>? Tools = null,
    // Maps to Ollama's num_predict. Bounds a call's output — e.g. a tool-calling classification
    // request that should never generate a full free-text answer.
    int? MaxOutputTokens = null
);

public record ChatMessage(
    string Role,
    string Content,
    List<string>? Images = null,
    List<ToolCall>? ToolCalls = null,
    string? ToolName = null);

public record ChatDelta(
    string? Token = null,
    List<ToolCall>? ToolCalls = null,
    bool Done = false,
    Usage? Usage = null,
    Guid? MessageId = null
);

public record ToolCall(string Name, JsonNode Arguments, string? Id = null);

public record ToolSchema(
    string Name,
    string Description,
    JsonNode Parameters
);

public record Usage(int? In, int? Out);

public record ModelInfo(string Name, long SizeBytes, string? Family, string? ParameterSize, string Tier);

public record LoadedModelInfo(
    string Name,
    long SizeBytes,
    long SizeBytesVram,
    string? Digest,
    DateTime? ExpiresAt
);

public record PullDelta(string Status, long? Completed, long? Total);

public interface IOllamaClient
{
    IAsyncEnumerable<ChatDelta> ChatStreamAsync(ChatRequest request, CancellationToken ct = default);

    /// <summary>Non-streaming single completion — used by the tool-call repair layer and the planner.</summary>
    Task<string> ChatOnceAsync(ChatRequest request, CancellationToken ct = default);

    Task<IReadOnlyList<ModelInfo>> ListModelsAsync(CancellationToken ct = default);

    Task<IReadOnlyList<LoadedModelInfo>> GetLoadedModelsAsync(CancellationToken ct = default);

    Task<bool> IsHealthyAsync(CancellationToken ct = default);

    IAsyncEnumerable<PullDelta> PullModelAsync(string name, CancellationToken ct = default);

    /// <summary>
    /// Forcibly unloads a model from VRAM by sending a keep_alive=0 generate request.
    /// Safe to call on models that are not currently loaded — the call will be a no-op.
    /// </summary>
    Task UnloadModelAsync(string modelName, CancellationToken ct = default);

    /// <summary>
    /// Warms up a model by loading it into memory without producing output.
    /// Fire-and-forget friendly — errors are silently swallowed.
    /// </summary>
    Task WarmUpModelAsync(string modelName, CancellationToken ct = default);

    /// <summary>
    /// §15 item 2 of AGENT_2_AGENT_ARCHITECTURE.md: calls `/api/generate` for an image-output model
    /// and returns the generated image as base64. The response shape for these models is not a
    /// documented Ollama contract, so implementations must validate the decoded bytes are a real
    /// image before returning, and throw otherwise rather than returning garbage — callers are
    /// expected to fall back to <c>FluxImageGenerator.GenerateViaCliAsync</c> on failure.
    /// </summary>
    Task<string> GenerateImageAsync(string model, string prompt, CancellationToken ct = default);
}
