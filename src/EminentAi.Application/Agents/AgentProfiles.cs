using System.Collections.Frozen;
using EminentAi.Application.Providers;

namespace EminentAi.Application.Agents;

/// <summary>
/// Server-side compile-time constants for every AgentProfile.
/// No code path accepts a raw string as a system prompt.
/// All profiles are immutable sealed records.
/// </summary>
public static class AgentProfiles
{
    public static readonly AgentProfile Vision = new(
        Kind: AgentKind.Vision,
        SystemPrompt: """
            You are a vision-capable AI assistant. When given an image:
            - Extract ALL visible text accurately, preserving structure (tables, lists, columns).
            - Describe diagrams, charts, or visuals that cannot be expressed as text.
            - Answer the user's specific question about the image.
            - For forms, invoices, or structured documents, present data in a markdown table.
            - Do not hallucinate content that is not visible.
            """,
        Temperature: 0.1f,
        RequiredCapabilities: new HashSet<ModelCapability> { ModelCapability.Vision }.ToFrozenSet()
    );

    public static readonly AgentProfile Coding = new(
        Kind: AgentKind.Coding,
        SystemPrompt: """
            You are an expert software engineer. When providing code:
            - Show complete, runnable examples — never pseudocode or stubs.
            - Use the language/framework the user specifies, or infer from context.
            - Include only the imports and setup that are actually needed.
            - If showing a real-world pattern, name it and explain the WHY in one sentence.
            - Prefer idiomatic, production-quality code.
            - If asked to debug, reproduce the error first, then fix it.
            """,
        Temperature: 0.1f,
        RequiredCapabilities: new HashSet<ModelCapability>
        {
            ModelCapability.TextGeneration,
            ModelCapability.CodeGeneration
        }.ToFrozenSet()
    );

    public static readonly AgentProfile Architecture = new(
        Kind: AgentKind.Architecture,
        SystemPrompt: """
            You are a senior software architect. Structure every design response as:

            ## Summary
            One paragraph: the system's purpose and the core architectural decision.

            ## HLD — High-Level Diagram
            ```mermaid
            graph TB
              [services and connections]
            ```

            ## LLD — Data Model
            ```mermaid
            classDiagram
              [key entities and relationships]
            ```

            ## Primary Flow — Sequence Diagram
            ```mermaid
            sequenceDiagram
              [happy path from user action to result]
            ```

            ## Decision Flow — Flowchart
            ```mermaid
            flowchart LR
              [branching logic and routing decisions]
            ```

            ## Technology Justification
            Bullet list: why each major technology was chosen.

            Always wrap Mermaid in triple-backtick mermaid fences.
            """,
        Temperature: 0.3f,
        RequiredCapabilities: new HashSet<ModelCapability>
        {
            ModelCapability.TextGeneration
        }.ToFrozenSet()
    );

    public static readonly AgentProfile ImageGeneration = new(
        Kind: AgentKind.ImageGeneration,
        SystemPrompt: "",   // not used — ImageGenerationAgent bypasses ChatService
        Temperature: 0f,
        RequiredCapabilities: new HashSet<ModelCapability> { ModelCapability.ImageGeneration }.ToFrozenSet()
    );

    public static readonly AgentProfile General = new(
        Kind: AgentKind.General,
        SystemPrompt: "You are EminentAi, a helpful AI assistant running fully locally.",
        Temperature: 0.7f,
        RequiredCapabilities: new HashSet<ModelCapability>
        {
            ModelCapability.TextGeneration
        }.ToFrozenSet()
    );

    public static AgentProfile ForKind(AgentKind kind) => kind switch
    {
        AgentKind.Vision          => Vision,
        AgentKind.Coding          => Coding,
        AgentKind.Architecture    => Architecture,
        AgentKind.ImageGeneration => ImageGeneration,
        _                         => General
    };
}
