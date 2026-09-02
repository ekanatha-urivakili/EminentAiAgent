namespace EminentAi.Application.Configuration;

/// <summary>
/// Config-driven model name matrix (§18.2 item 4 / §18.7 Phase 1 of AGENT_2_AGENT_ARCHITECTURE.md).
/// Previously these names were hardcoded C# constants spread across IntentRouterService,
/// ModelRouterService, and ImageGenerationAgent — swapping a local model required a code change
/// and a rebuild. Bound from the "EminentAi:ModelMatrix" section in appsettings.json; every
/// property has a default equal to the value that was previously hardcoded, so an absent or
/// partial config section reproduces today's behaviour exactly.
/// </summary>
public sealed class ModelMatrixOptions
{
    public const string SectionName = "EminentAi:ModelMatrix";

    public string ClassifierPrimary { get; set; } = "gemma4:e4b";
    public string ClassifierFallback { get; set; } = "ornith-1.5:9b";

    public string ImageAnalystPrimary { get; set; } = "gemma4:e4b";
    public string ImageAnalystFallback { get; set; } = "ornith-1.5:9b";

    public string ImageVisionPrimary { get; set; } = "qwen3-vl:latest";
    public string ImageVisionFallback { get; set; } = "qwen3.5:9b";

    public string ImageGenPrimary { get; set; } = "x/flux2-klein:latest";
    public string ImageGenFallback { get; set; } = "x/z-image-turbo";

    /// <summary>
    /// §15 item 2: opt-in switch to try `/api/generate` before the `ollama run` CLI subprocess for
    /// image generation. Defaults to false — this migration was reverted once before over an
    /// unverified response shape, so it ships off until verified against the models actually
    /// installed on a given machine. The CLI path always remains the automatic fallback regardless
    /// of this setting.
    /// </summary>
    public bool UseHttpGenerateForImages { get; set; } = false;

    /// <summary>Keyed by <see cref="EminentAi.Application.Agents.AgentKind"/> name. Earlier entries in each array win.</summary>
    public Dictionary<string, string[]> NamePriorities { get; set; } = new()
    {
        ["Vision"] =
            ["qwen3-vl:latest", "qwen3-vl", "qwen3.5:9b", "qwen3.5:4b", "qwen3.5", "qwen2.5vl", "vl", "vision", "llava", "moondream"],
        ["Coding"] =
            ["ornith-1.5:9b", "ornith", "gemma4:e4b", "qwen3.5:9b", "qwen3.5:4b", "qwen3.5", "qwen2.5-coder", "coder", "deepseek-coder"],
        ["Architecture"] =
            ["ornith-1.5:9b", "ornith", "gemma4:e4b", "qwen3.5:9b", "qwen3.5:4b", "qwen3.5", "gemma4", "qwen2.5:latest", "qwen2.5"],
        ["ImageGeneration"] =
            ["x/flux2-klein:latest", "flux2-klein", "flux", "diffusion"],
        ["General"] =
            ["gemma4:e4b", "ornith-1.5:9b", "ornith", "qwen3.5:9b", "qwen3.5:4b", "qwen3.5", "qwen2.5:latest", "qwen2.5", "llama3"],
    };
}
