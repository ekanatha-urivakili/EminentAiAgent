using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using EminentAi.Application.Abstractions;

namespace EminentAi.Infrastructure.Ollama;

public sealed class OllamaClient(HttpClient http) : IOllamaClient
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public async IAsyncEnumerable<ChatDelta> ChatStreamAsync(
        ChatRequest req, [EnumeratorCancellation] CancellationToken ct = default)
    {
        using var message = new HttpRequestMessage(HttpMethod.Post, "/api/chat")
        {
            Content = JsonContent.Create(BuildPayload(req, stream: true), options: JsonOpts)
        };
        using var response = await http.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException($"Ollama returned {(int)response.StatusCode}: {Truncate(body, 500)}");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        while (!ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (line is null) break;
            if (string.IsNullOrWhiteSpace(line)) continue;

            OllamaChatResponse? delta;
            try { delta = JsonSerializer.Deserialize<OllamaChatResponse>(line); }
            catch (JsonException) { continue; } // skip malformed keep-alive lines
            if (delta is null) continue;

            List<ToolCall>? toolCalls = null;
            if (delta.Message?.ToolCalls is { Count: > 0 } calls)
            {
                toolCalls = calls.ConvertAll(tc =>
                    new ToolCall(tc.Function.Name, tc.Function.Arguments ?? new JsonObject()));
            }

            yield return new ChatDelta(
                string.IsNullOrEmpty(delta.Message?.Content) ? null : delta.Message.Content,
                toolCalls,
                delta.Done,
                delta.Done ? new Usage(delta.PromptEvalCount, delta.EvalCount) : null
            );

            if (delta.Done) break;
        }
    }

    public async Task<string> ChatOnceAsync(ChatRequest req, CancellationToken ct = default)
    {
        using var response = await http.PostAsJsonAsync("/api/chat", BuildPayload(req, stream: false), JsonOpts, ct);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<OllamaChatResponse>(cancellationToken: ct);
        return body?.Message?.Content ?? "";
    }

    public async Task<IReadOnlyList<ModelInfo>> ListModelsAsync(CancellationToken ct = default)
    {
        var response = await http.GetFromJsonAsync<OllamaTagsResponse>("/api/tags", ct);
        if (response?.Models is null) return Array.Empty<ModelInfo>();

        return response.Models.ConvertAll(m => new ModelInfo(
            m.Name,
            m.Size,
            m.Details?.Family,
            m.Details?.ParameterSize,
            ClassifyTier(m.Name, m.Details?.ParameterSize)
        ));
    }

    public async Task<IReadOnlyList<LoadedModelInfo>> GetLoadedModelsAsync(CancellationToken ct = default)
    {
        try
        {
            var response = await http.GetFromJsonAsync<OllamaPsResponse>("/api/ps", ct);
            if (response?.Models is null) return Array.Empty<LoadedModelInfo>();

            return response.Models.ConvertAll(m => new LoadedModelInfo(
                m.Name,
                m.Size,
                m.SizeVram,
                m.Digest,
                m.ExpiresAt
            ));
        }
        catch
        {
            return Array.Empty<LoadedModelInfo>();
        }
    }

    public async Task<bool> IsHealthyAsync(CancellationToken ct = default)
    {
        try
        {
            using var response = await http.GetAsync("/api/tags", ct);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Tiering for the UI's model selector: fast / balanced / reasoning / vision / embedding.</summary>
    private static string ClassifyTier(string name, string? parameterSize)
    {
        var n = name.ToLowerInvariant();
        if (n.Contains("embed") || n.Contains("nomic") || n.Contains("bge")) return "embedding";
        if (n.Contains("vl") || n.Contains("vision") || n.Contains("llava") || n.Contains("moondream")) return "vision";
        if (n.Contains("r1") || n.Contains("reason") || n.Contains("think") || n.Contains("qwq")) return "reasoning";

        if (parameterSize is not null &&
            double.TryParse(parameterSize.TrimEnd('B', 'b', 'M', 'm'), out var size))
        {
            if (parameterSize.EndsWith("M", StringComparison.OrdinalIgnoreCase)) return "fast";
            return size <= 3 ? "fast" : "balanced";
        }
        return "balanced";
    }

    private static object BuildPayload(ChatRequest req, bool stream) => new
    {
        model = req.Model,
        messages = req.Messages.ConvertAll(m => new { role = m.Role, content = m.Content, images = m.Images }),
        tools = req.Tools?.ConvertAll(t => new
        {
            type = "function",
            function = new { name = t.Name, description = t.Description, parameters = t.Parameters }
        }),
        options = new
        {
            temperature = req.Temperature,
            num_ctx = req.ContextWindow ?? 8192,
            // KV cache quantization is mandatory on 16 GB machines (see architecture §0.5)
            f16_kv = false
        },
        format = req.ForceJson ? "json" : null,
        stream,
        keep_alive = "10m"
    };

    public async IAsyncEnumerable<PullDelta> PullModelAsync(string name, [EnumeratorCancellation] CancellationToken ct = default)
    {
        using var message = new HttpRequestMessage(HttpMethod.Post, "/api/pull")
        {
            Content = JsonContent.Create(new { name, stream = true })
        };
        using var response = await http.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        while (!ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (line is null) break;
            if (string.IsNullOrWhiteSpace(line)) continue;

            OllamaPullLine? delta;
            try { delta = JsonSerializer.Deserialize<OllamaPullLine>(line); }
            catch (JsonException) { continue; }
            if (delta is null) continue;

            yield return new PullDelta(delta.Status ?? "", delta.Completed, delta.Total);
            if (delta.Status == "success") break;
        }
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max] + "…";

    private sealed class OllamaChatResponse
    {
        [JsonPropertyName("message")] public OllamaMessage? Message { get; set; }
        [JsonPropertyName("done")] public bool Done { get; set; }
        [JsonPropertyName("prompt_eval_count")] public int? PromptEvalCount { get; set; }
        [JsonPropertyName("eval_count")] public int? EvalCount { get; set; }
    }

    private sealed class OllamaMessage
    {
        [JsonPropertyName("role")] public string Role { get; set; } = string.Empty;
        [JsonPropertyName("content")] public string Content { get; set; } = string.Empty;
        [JsonPropertyName("tool_calls")] public List<OllamaToolCall>? ToolCalls { get; set; }
    }

    private sealed class OllamaToolCall
    {
        [JsonPropertyName("function")] public OllamaFunction Function { get; set; } = null!;
    }

    private sealed class OllamaFunction
    {
        [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
        [JsonPropertyName("arguments")] public JsonNode? Arguments { get; set; }
    }

    private sealed class OllamaTagsResponse
    {
        [JsonPropertyName("models")] public List<OllamaModel>? Models { get; set; }
    }

    private sealed class OllamaPsResponse
    {
        [JsonPropertyName("models")] public List<OllamaPsModel>? Models { get; set; }
    }

    private sealed class OllamaPsModel
    {
        [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
        [JsonPropertyName("size")] public long Size { get; set; }
        [JsonPropertyName("size_vram")] public long SizeVram { get; set; }
        [JsonPropertyName("digest")] public string? Digest { get; set; }
        [JsonPropertyName("expires_at")] public DateTime? ExpiresAt { get; set; }
    }

    private sealed class OllamaModel
    {
        [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
        [JsonPropertyName("size")] public long Size { get; set; }
        [JsonPropertyName("details")] public OllamaModelDetails? Details { get; set; }
    }

    private sealed class OllamaModelDetails
    {
        [JsonPropertyName("family")] public string? Family { get; set; }
        [JsonPropertyName("parameter_size")] public string? ParameterSize { get; set; }
    }

    private sealed class OllamaPullLine
    {
        [JsonPropertyName("status")] public string? Status { get; set; }
        [JsonPropertyName("completed")] public long? Completed { get; set; }
        [JsonPropertyName("total")] public long? Total { get; set; }
    }
}
