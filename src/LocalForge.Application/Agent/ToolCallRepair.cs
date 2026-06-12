using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LocalForge.Application.Abstractions;

namespace LocalForge.Application.Agent;

/// <summary>
/// Small local models emit malformed tool calls 5–15% of the time. This layer recovers most of
/// them: strict parse → mechanical JSON repair → one constrained re-ask with the error embedded.
/// It also maps un-namespaced / aliased tool names back onto the known schema set.
/// </summary>
public static partial class ToolCallRepair
{
    [GeneratedRegex("```(?:json)?\\s*([\\s\\S]*?)```", RegexOptions.Multiline)]
    private static partial Regex FencedBlock();

    /// <summary>Try to interpret assistant *content* as an inline tool call (common on 7B models).</summary>
    public static ToolCall? TryParseInlineToolCall(string content, IReadOnlyList<ToolSchema> schemas)
    {
        var candidate = ExtractJsonObject(content);
        if (candidate is null) return null;
        return TryStrictParse(candidate, schemas);
    }

    public static async Task<ToolCall?> ParseOrRepairAsync(
        IOllamaClient ollama, string model, string raw, IReadOnlyList<ToolSchema> schemas, CancellationToken ct)
    {
        var candidate = ExtractJsonObject(raw);
        if (candidate is not null)
        {
            var call = TryStrictParse(candidate, schemas);
            if (call is not null) return call;

            var mechanical = MechanicalRepair(candidate);
            call = TryStrictParse(mechanical, schemas);
            if (call is not null) return call;
        }

        // Last resort: one re-ask with format:json and the validation problem embedded.
        var prompt =
            "The following text was supposed to be a single JSON tool call of the form " +
            "{\"name\": \"<tool>\", \"arguments\": { ... }}. " +
            $"Valid tool names: {string.Join(", ", schemas.Select(s => s.Name))}. " +
            "Re-emit it as strict, valid JSON only — no prose, no markdown.\n\n" + raw;

        try
        {
            var retry = await ollama.ChatOnceAsync(
                new ChatRequest(model, new List<ChatMessage> { new("user", prompt) }, Temperature: 0f, ForceJson: true), ct);
            var repaired = ExtractJsonObject(retry);
            return repaired is null ? null : TryStrictParse(repaired, schemas);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Maps "search", "functions.jira.search", "jira_search" → "jira.search" when unambiguous.</summary>
    public static string? ResolveToolName(string name, IReadOnlyList<ToolSchema> schemas)
    {
        if (schemas.Any(s => s.Name == name)) return name;

        var trimmed = name.StartsWith("functions.", StringComparison.OrdinalIgnoreCase) ? name[10..] : name;
        if (schemas.Any(s => s.Name == trimmed)) return trimmed;

        var underscoreToDot = trimmed.Replace('_', '.');
        var exact = schemas.FirstOrDefault(s => s.Name.Equals(underscoreToDot, StringComparison.OrdinalIgnoreCase));
        if (exact is not null) return exact.Name;

        // Unique suffix match: "read_file" → "filesystem.read_file"
        var suffixMatches = schemas.Where(s =>
            s.Name.EndsWith("." + trimmed, StringComparison.OrdinalIgnoreCase)).ToList();
        return suffixMatches.Count == 1 ? suffixMatches[0].Name : null;
    }

    private static ToolCall? TryStrictParse(string json, IReadOnlyList<ToolSchema> schemas)
    {
        try
        {
            var node = JsonNode.Parse(json);
            if (node is not JsonObject obj) return null;

            var name = obj["name"]?.GetValue<string>()
                       ?? obj["tool"]?.GetValue<string>()
                       ?? obj["function"]?["name"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(name)) return null;

            var resolved = ResolveToolName(name.Trim(), schemas);
            if (resolved is null) return null;

            var args = obj["arguments"] ?? obj["args"] ?? obj["parameters"] ?? obj["function"]?["arguments"];
            if (args is JsonValue v && v.TryGetValue<string>(out var inner))
                args = JsonNode.Parse(inner);

            return new ToolCall(resolved, args?.DeepClone() ?? new JsonObject());
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException)
        {
            return null;
        }
    }

    private static string? ExtractJsonObject(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var text = raw.Trim();

        var fence = FencedBlock().Match(text);
        if (fence.Success) text = fence.Groups[1].Value.Trim();

        var start = text.IndexOf('{');
        if (start < 0) return null;

        var depth = 0;
        var inString = false;
        for (var i = start; i < text.Length; i++)
        {
            var c = text[i];
            if (inString)
            {
                if (c == '\\') i++;
                else if (c == '"') inString = false;
                continue;
            }
            if (c == '"') inString = true;
            else if (c == '{') depth++;
            else if (c == '}' && --depth == 0) return text[start..(i + 1)];
        }
        return text[start..]; // unbalanced — mechanical repair may still fix it
    }

    private static string MechanicalRepair(string json)
    {
        var s = json.Trim();
        s = Regex.Replace(s, ",\\s*([}\\]])", "$1");          // trailing commas
        s = Regex.Replace(s, "(?<=[{,]\\s*)'([^']*)'\\s*:", "\"$1\":"); // single-quoted keys
        s = Regex.Replace(s, ":\\s*'([^']*)'", ": \"$1\"");   // single-quoted values

        var open = s.Count(c => c == '{') - s.Count(c => c == '}');
        if (open > 0) s += new string('}', open);
        return s;
    }
}
