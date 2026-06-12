using System.Text.Json;
using System.Text.Json.Nodes;
using LocalForge.Application.Abstractions;

namespace LocalForge.Application.Planning;

public record PlanStep(int Ordinal, string Title, string Detail);
public record Plan(string Goal, List<PlanStep> Steps);

/// <summary>
/// Plan mode is read-only: it produces an editable, numbered plan (no tool execution).
/// JSON output is schema-validated with up to two constrained repair retries.
/// </summary>
public class PlannerService(IOllamaClient ollama)
{
    private const string PlannerPrompt =
        "You are a planning assistant. Break the user's goal into 3-8 concrete, ordered steps. " +
        "Respond with ONLY valid JSON matching exactly this schema, nothing else:\n" +
        "{\"steps\": [{\"title\": \"short imperative title\", \"detail\": \"1-2 sentence explanation\"}]}";

    public async Task<Plan> CreatePlanAsync(string goal, string model, CancellationToken ct = default)
    {
        var messages = new List<ChatMessage>
        {
            new("system", PlannerPrompt),
            new("user", $"Goal: {goal}")
        };

        string? lastError = null;
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var ask = attempt == 0
                ? messages
                : new List<ChatMessage>(messages)
                {
                    new("user", $"Your previous output was invalid ({lastError}). " +
                                 "Re-emit ONLY the JSON object, with no markdown fences and no commentary.")
                };

            var raw = await ollama.ChatOnceAsync(
                new ChatRequest(model, ask, Temperature: 0.1f, ForceJson: true), ct);

            if (TryParse(goal, raw, out var plan, out lastError))
                return plan!;
        }

        throw new InvalidOperationException($"Planner failed to produce valid JSON: {lastError}");
    }

    private static bool TryParse(string goal, string raw, out Plan? plan, out string? error)
    {
        plan = null;
        error = null;
        try
        {
            var text = raw.Trim();
            var start = text.IndexOf('{');
            var end = text.LastIndexOf('}');
            if (start < 0 || end <= start) { error = "no JSON object found"; return false; }
            text = text[start..(end + 1)];

            var node = JsonNode.Parse(text);
            if (node?["steps"] is not JsonArray steps || steps.Count == 0)
            { error = "missing non-empty 'steps' array"; return false; }

            var parsed = new List<PlanStep>();
            var ordinal = 1;
            foreach (var step in steps)
            {
                var title = step?["title"]?.GetValue<string>();
                if (string.IsNullOrWhiteSpace(title)) { error = "step missing 'title'"; return false; }
                var detail = step?["detail"]?.GetValue<string>() ?? "";
                parsed.Add(new PlanStep(ordinal++, title.Trim(), detail.Trim()));
            }

            plan = new Plan(goal, parsed);
            return true;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException)
        {
            error = ex.Message;
            return false;
        }
    }
}
