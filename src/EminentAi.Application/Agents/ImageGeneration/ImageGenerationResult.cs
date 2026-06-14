namespace EminentAi.Application.Agents.ImageGeneration;

public sealed record ImageGenerationResult(
    string Url,
    string Filename,
    string FluxPrompt,
    long GenerationMs
);
