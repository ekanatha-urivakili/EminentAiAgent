using EminentAi.Application.Abstractions;
using EminentAi.Application.Agents;

namespace EminentAi.Application.Providers;

public sealed record ModelInvocation(
    string ModelName,
    List<ChatMessage> Messages,
    AgentProfile Profile,
    List<string>? ImageBase64 = null
);
