using EminentAi.Application.Providers;

namespace EminentAi.Application.Agents;

/// <summary>
/// Server-side constant describing an agent's system prompt, temperature, and required model capabilities.
/// Never constructed from user input or HTTP fields.
/// </summary>
public sealed record AgentProfile(
    AgentKind Kind,
    string SystemPrompt,
    float Temperature,
    IReadOnlySet<ModelCapability> RequiredCapabilities
);
