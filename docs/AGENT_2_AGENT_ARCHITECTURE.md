# Agent-to-Agent Orchestration Architecture

> **EminentAi — Multi-Agent Routing System**
> Version 2.0 — revised after principal-engineer review.
> Designed for: automatic intent detection, specialized agent dispatch, image generation, and architecture planning.
> Provider-agnostic: Ollama local models today, Claude / ChatGPT / Copilot extensible by design.

---

## Revision Notes (v1 → v2)

| Finding | Severity | Resolution in this document |
|---|---|---|
| Bypassed `AgentOrchestrator` — not true A2A | High | Added `AgentOrchestratorFacade` owning the full chain: intent → model → provider → persist → SSE |
| "All local" hard-coded — no provider abstraction | High | Added `IModelProvider`, `ModelCapability`, `ModelRoute`, `ProviderHealth`, `CostPolicy`, `DataResidencyPolicy` |
| `systemPromptOverride` as raw string | High | Replaced with `AgentProfile` + `PromptProfileKind` enum, server-side only |
| `done` emitted before DB persistence | Medium | Fixed in all sequence diagrams: persist → emit `persisted` → emit `done` |
| Classifier confidence / telemetry missing | Medium | Added `ClassificationRecord` with confidence, raw output, and telemetry log |
| Flux `/api/generate` response shape unverified | Medium | Added spike task to implementation order; two fallback parse paths documented |
| Generated images served without auth | Medium | Requires same bearer token; ownership verified against `branchId` in DB |
| `autoRouteHint` semantics undefined | Medium | Treated as advisory `AgentKind?`; validated to enum; actual route always returned |
| No `AgentProfile` record — "no new class" | Low | All agents now use `AgentProfile` — consistent, extensible, zero duplication |
| Image gen first in impl order — wrong | Low | Routing + text flows first; image gen after Flux spike confirmation |
| Defensive label parsing not specified | PE note | Documented: trim, uppercase, strict enum match; unknown → `General` + log warning |
| VRAM swapping under multiple large models | PE note | `keep_alive` strategy and model-warm-up recommendation documented |
| `generated-images/` not in `.gitignore` | PE note | Added to file map and `.gitignore` section |

---

## Table of Contents

1. [Overview](#1-overview)
2. [Installed Ollama Models & Their Roles](#2-installed-ollama-models--their-roles)
3. [Existing Infrastructure (What We Keep)](#3-existing-infrastructure-what-we-keep)
4. [Core Abstractions (New Contracts)](#4-core-abstractions-new-contracts)
   - 4.1 [AgentKind & AgentProfile](#41-agentkind--agentprofile)
   - 4.2 [IModelProvider & Provider Abstraction](#42-imodelprovider--provider-abstraction)
   - 4.3 [IIntentRouter & RoutingDecision](#43-iintentrouter--routingdecision)
   - 4.4 [IModelRouter & ModelRoute](#44-imodelrouter--modelroute)
   - 4.5 [ISpecializedAgent](#45-ispecializedagent)
5. [High-Level Architecture (HLD)](#5-high-level-architecture-hld)
6. [Component Design (LLD)](#6-component-design-lld)
   - 6.1 [AgentOrchestratorFacade](#61-agentorchestratorfacade)
   - 6.2 [IntentRouterService](#62-intentrouterservice)
   - 6.3 [ModelRouterService](#63-modelrouterservice)
   - 6.4 [OllamaModelProvider](#64-ollamamodelprovider)
   - 6.5 [VisionAgent](#65-visionagent)
   - 6.6 [CodeAgent](#66-codeagent)
   - 6.7 [ArchitectureAgent](#67-architectureagent)
   - 6.8 [ImageGenerationAgent](#68-imagegenerationagent)
   - 6.9 [GeneralAgent](#69-generalagent)
7. [Sequence Diagrams](#7-sequence-diagrams)
   - 7.1 [Flow 1 — Vision / Image Reading](#71-flow-1--vision--image-reading)
   - 7.2 [Flow 2 — Code Request](#72-flow-2--code-request)
   - 7.3 [Flow 3 — Architecture & Design](#73-flow-3--architecture--design)
   - 7.4 [Flow 4 — Image Generation](#74-flow-4--image-generation)
   - 7.5 [Flow 5 — General Request](#75-flow-5--general-request)
   - 7.6 [Flow 6 — Intent Classification (Internal)](#76-flow-6--intent-classification-internal)
   - 7.7 [Flow 7 — Provider Fallback Chain](#77-flow-7--provider-fallback-chain)
8. [Overall Orchestration Flowchart](#8-overall-orchestration-flowchart)
9. [Smart Endpoint Contract](#9-smart-endpoint-contract)
10. [New SSE Event Types](#10-new-sse-event-types)
11. [Backend File Map](#11-backend-file-map)
12. [Frontend File Map](#12-frontend-file-map)
13. [Changes to Existing Files](#13-changes-to-existing-files)
14. [Implementation Order](#14-implementation-order)
15. [Model Fallback Matrix](#15-model-fallback-matrix)
16. [Security Considerations](#16-security-considerations)
17. [Operational Notes](#17-operational-notes)

---

## 1. Overview

Today every chat message goes to whatever model the user manually selected. There is no intelligence deciding *which* model is best for a given task, and there is no mechanism to route to a different provider (Claude, ChatGPT, Copilot) without rewriting the infrastructure.

This architecture corrects both problems by inserting a **true orchestration layer** between the user's message and any model call. The key insight from the v1 review: the original design bypassed `AgentOrchestrator` and wired `SmartAPI` directly to `ChatService` and `ImageGenerationAgent`. This document replaces that with a proper chain where **one facade owns routing, execution, persistence, and SSE streaming**.

```
SmartChatEndpoint
  → AgentOrchestratorFacade        (owns the whole turn: intent → model → execute → persist → SSE)
    → IntentRouter                  (classifies intent via fast-path or qwen3.5:2b)
    → ModelRouter                   (resolves best model+provider per intent)
    → ISpecializedAgent             (Vision / Code / Arch / ImageGen / General)
      → IModelProvider              (Ollama today; Claude / ChatGPT / Copilot tomorrow)
    → ChatService                   (persistence: messages, attachments)
    → SSE response stream
```

The existing `POST /api/branches/:id/messages` endpoint is **unchanged**. The smart path is a new additive endpoint: `POST /api/chat/smart`.

**Intent kinds:**

| Intent | Trigger condition | Default provider model |
|---|---|---|
| `Vision` | Image attached + question about its contents | `qwen2.5vl:latest` (Ollama) |
| `Coding` | Code, debugging, real-world examples | `qwen2.5-coder:1.5b` (Ollama) |
| `Architecture` | System design, HLD/LLD, diagrams | `qwen3:latest` (Ollama) |
| `ImageGeneration` | "Generate / draw / create a logo / image" | `x/flux2-klein:4b` (Ollama) |
| `General` | Everything else | `qwen2.5:latest` (Ollama) |

---

## 2. Installed Ollama Models & Their Roles

```
NAME                       SIZE     TIER           ROLE IN THIS SYSTEM
─────────────────────────────────────────────────────────────────────────
qwen3.5:2b                 2.7 GB   fast           Intent classifier (sub-500ms, low VRAM)
qwen2.5-coder:1.5b         986 MB   fast           Code Agent — fastest code completions
qwen2.5:latest             4.7 GB   balanced       General Agent — default fallback
qwen3:latest               5.2 GB   balanced       Architecture Agent — primary (strong reasoning)
gemma4:e4b                 9.6 GB   balanced       Architecture Agent — fallback (large, capable)
qwen2.5vl:latest           6.0 GB   vision         Vision Agent — only multimodal model installed
x/flux2-klein:4b           5.7 GB   image_gen      Image Generation Agent — Flux2 diffusion
nomic-embed-text:latest    274 MB   embedding      Reserved: RAG / semantic search
```

**VRAM note:** `x/flux2-klein:4b` + `qwen2.5vl:latest` are both large. Ollama will unload the previous model before loading the next. This causes a "cold start" delay on the first token. Mitigations:

- The `keep_alive: "10m"` already set in `OllamaClient.BuildPayload` keeps models warm between calls.
- `qwen3.5:2b` (the classifier) is tiny enough to stay loaded alongside any other model on 16 GB machines.
- Image generation (`flux2-klein`) should warn the user of 30–120 second generation time via `image_gen_progress` SSE events — these are not optional UX polish, they are **required** so the user does not think the system has crashed.

**Flux API spike required:** `x/flux2-klein:4b` is a diffusion model, not a chat model. Before implementing `ImageGenerationAgent`, run this verification:

```bash
curl http://127.0.0.1:11434/api/generate \
  -d '{"model":"x/flux2-klein:4b","prompt":"minimalist logo, AI startup","stream":false}'
```

Confirm the response shape is `{ "response": "<base64 PNG string>" }`. If the model returns a file path, a URL, chunked data, or a different JSON key, the `GenerateImageAsync` implementation must be adjusted accordingly. **Do not implement `ImageGenerationAgent` before running this spike.**

---

## 3. Existing Infrastructure (What We Keep)

```mermaid
graph LR
    subgraph "Already Built — Keep As Is"
        OC["OllamaClient : IOllamaClient\n• ChatStreamAsync\n• ChatOnceAsync\n• ListModelsAsync\n• GetLoadedModelsAsync\n• ClassifyTier()"]
        CS["ChatService\n• SendMessageAsync\n• RegenerateAsync\n• BranchConversationAsync\n• image attachment support"]
        AO["AgentOrchestrator\n• Full ReAct loop\n• Tool call gates\n• Policy engine\n• Approval broker"]
        PS["PlannerService\n• JSON structured output\n• Retry with repair"]
        DB[(SQLite\nConversations · Messages\nAttachments · AgentRuns)]
    end

    subgraph "New Orchestration Layer — Added On Top"
        AOF["AgentOrchestratorFacade"]
        IR["IntentRouter"]
        MR["ModelRouter"]
        IPA["IModelProvider\n(OllamaModelProvider today)"]
    end

    AOF --> IR --> MR --> IPA
    AOF --> CS --> OC --> DB
    IPA --> OC
```

`ClassifyTier()` in `OllamaClient` already labels models as `vision`, `fast`, `balanced`, `reasoning`, `embedding`. `ModelRouter` uses these labels for tier-based fallbacks when a preferred model is not installed.

The existing `AgentOrchestrator` (ReAct loop with MCP tool calls) remains for agentic runs. `AgentOrchestratorFacade` is a **separate, lighter orchestrator** for the chat-smart flow — it does not replace the ReAct loop.

---

## 4. Core Abstractions (New Contracts)

### 4.1 AgentKind & AgentProfile

`AgentProfile` replaces the raw `systemPromptOverride` string. `ChatService` will accept an `AgentProfile?` — never a raw string from user input or any external source.

```csharp
// EminentAi.Application/Agents/AgentKind.cs
public enum AgentKind
{
    Vision,
    Coding,
    Architecture,
    ImageGeneration,
    General
}

// EminentAi.Application/Agents/AgentProfile.cs
public sealed record AgentProfile(
    AgentKind Kind,
    string SystemPrompt,
    float Temperature,
    IReadOnlySet<string> RequiredCapabilities  // e.g. {"vision"}, {"image_gen"}
);

// EminentAi.Application/Agents/AgentProfiles.cs
// All profiles are constants defined server-side. No user input ever reaches SystemPrompt.
public static class AgentProfiles
{
    public static readonly AgentProfile Vision = new(
        AgentKind.Vision,
        SystemPrompt: """
            You are a vision-capable AI assistant. When given an image:
            - Extract ALL visible text accurately, preserving structure (tables, lists, columns).
            - Describe any diagrams, charts, or visual elements that cannot be expressed as text.
            - Answer the user's specific question about the image contents.
            - If the image contains a form, invoice, or structured document, present data
              in a markdown table. Do not hallucinate content that is not visible.
            """,
        Temperature: 0.1f,
        RequiredCapabilities: new HashSet<string> { "vision" }
    );

    public static readonly AgentProfile Coding = new(
        AgentKind.Coding,
        SystemPrompt: """
            You are an expert software engineer. When providing code:
            - Show complete, runnable examples — never pseudocode or stubs.
            - Use the language/framework the user specifies, or infer from context.
            - Include only the imports and setup that are actually needed.
            - If showing a real-world pattern, name the pattern and explain the WHY in one sentence.
            - Prefer idiomatic, production-quality code over simplified toy examples.
            - If the user asks to debug, reproduce the error first, then fix it.
            """,
        Temperature: 0.1f,
        RequiredCapabilities: new HashSet<string>()
    );

    public static readonly AgentProfile Architecture = new(
        AgentKind.Architecture,
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

            Always wrap Mermaid in triple-backtick mermaid fences. The frontend renders them natively.
            """,
        Temperature: 0.3f,
        RequiredCapabilities: new HashSet<string>()
    );

    public static readonly AgentProfile ImageGeneration = new(
        AgentKind.ImageGeneration,
        SystemPrompt: "",   // not used — ImageGenerationAgent bypasses ChatService
        Temperature: 0f,
        RequiredCapabilities: new HashSet<string> { "image_gen" }
    );

    public static readonly AgentProfile General = new(
        AgentKind.General,
        SystemPrompt: "You are EminentAi, a helpful AI assistant running fully locally.",
        Temperature: 0.7f,
        RequiredCapabilities: new HashSet<string>()
    );

    public static AgentProfile ForKind(AgentKind kind) => kind switch
    {
        AgentKind.Vision        => Vision,
        AgentKind.Coding        => Coding,
        AgentKind.Architecture  => Architecture,
        AgentKind.ImageGeneration => ImageGeneration,
        AgentKind.General       => General,
        _                       => General
    };
}
```

---

### 4.2 IModelProvider & Provider Abstraction

This abstraction makes the system provider-agnostic. Today only `OllamaModelProvider` is implemented. Adding Claude, ChatGPT, or GitHub Copilot later means implementing `IModelProvider` — nothing else changes.

```mermaid
classDiagram
    class ModelCapability {
        <<enumeration>>
        TextGeneration
        Vision
        ImageGeneration
        Embedding
        Reasoning
        CodeGeneration
        FunctionCalling
    }

    class ModelDescriptor {
        +string Name
        +string ProviderName
        +IReadOnlySet~ModelCapability~ Capabilities
        +long SizeBytes
        +string Tier
        +bool IsAvailable
    }

    class ModelRoute {
        +ModelDescriptor Model
        +string ProviderName
        +AgentProfile Profile
        +string SelectionReason
        +bool IsExactMatch
    }

    class ProviderHealth {
        +string ProviderName
        +bool IsHealthy
        +string? ErrorMessage
        +DateTime CheckedAt
    }

    class CostPolicy {
        +bool PreferLocal
        +decimal? MaxCostPerTokenUsd
        +IReadOnlySet~string~ BlockedProviders
    }

    class DataResidencyPolicy {
        +bool LocalOnly
        +IReadOnlySet~string~ AllowedRegions
    }

    class IModelProvider {
        <<interface>>
        +string Name
        +Task~IReadOnlyList~ModelDescriptor~~ ListModelsAsync(CancellationToken ct)
        +IAsyncEnumerable~ChatDelta~ StreamAsync(ModelInvocation invocation, CancellationToken ct)
        +Task~ProviderHealth~ CheckHealthAsync(CancellationToken ct)
    }

    class ModelInvocation {
        +string ModelName
        +List~ChatMessage~ Messages
        +AgentProfile Profile
        +List~string~? ImageBase64
    }

    class OllamaModelProvider {
        -IOllamaClient _client
        +Name: "ollama"
        +ListModelsAsync()
        +StreamAsync()
        +CheckHealthAsync()
    }

    IModelProvider <|.. OllamaModelProvider
    ModelInvocation --> AgentProfile
    ModelRoute --> ModelDescriptor
    ModelRoute --> AgentProfile
```

**Future providers** implement `IModelProvider` and are registered in DI. `ModelRouter` queries all healthy providers and ranks candidates:

```
Priority: CostPolicy.PreferLocal → DataResidencyPolicy.LocalOnly → RequiredCapabilities match
         → ModelDescriptor.Tier match → SizeBytes (larger preferred for architecture/reasoning)
```

---

### 4.3 IIntentRouter & RoutingDecision

```csharp
// EminentAi.Application/Routing/IIntentRouter.cs
public interface IIntentRouter
{
    Task<RoutingDecision> RouteAsync(IntentRequest request, CancellationToken ct = default);
}

public sealed record IntentRequest(
    string UserText,
    bool HasImageAttachment,
    IReadOnlyList<string> AttachmentContentTypes,
    AgentKind? HintOverride   // advisory only — user opt-in; validated to enum before use
);

public sealed record RoutingDecision(
    AgentKind Intent,
    AgentProfile Profile,
    ModelRoute ModelRoute,
    string ClassifierModel,
    long ClassificationMs,
    ClassificationRecord? Telemetry
);

public sealed record ClassificationRecord(
    string RawLabel,           // exact string the LLM emitted — logged for debugging
    bool WasFastPath,          // true if regex short-circuit fired
    float? ConfidenceHint,     // reserved: if classifier emits logprobs in future
    bool HintOverrideApplied,  // true if user's autoRouteHint changed the result
    string? OverrideOriginalLabel
);
```

**Defensive label parsing rule** — applied before any label reaches business logic:

```csharp
private static AgentKind ParseIntentLabel(string raw)
{
    // Trim whitespace, remove punctuation, uppercase — handles "Here is: CODING\n" etc.
    var clean = Regex.Replace(raw.Trim().ToUpperInvariant(), @"[^A-Z_]", "");
    return clean switch
    {
        "VISION"        => AgentKind.Vision,
        "CODING"        => AgentKind.Coding,
        "ARCHITECTURE"  => AgentKind.Architecture,
        "IMAGE_GEN"
        or "IMAGE"
        or "IMAGEGEN"   => AgentKind.ImageGeneration,
        "GENERAL"       => AgentKind.General,
        // Unknown label: log warning + default to General — never throw
        _ => AgentKind.General
    };
}
```

The raw label is always stored in `ClassificationRecord.RawLabel` regardless of parse outcome, so misrouting can be diagnosed from logs.

---

### 4.4 IModelRouter & ModelRoute

```csharp
// EminentAi.Application/Routing/IModelRouter.cs
public interface IModelRouter
{
    Task<ModelRoute> ResolveAsync(
        AgentProfile profile,
        CostPolicy costPolicy,
        DataResidencyPolicy residencyPolicy,
        CancellationToken ct = default);
}
```

`ModelRouterService` queries all registered `IModelProvider` instances, filters by health, filters by `DataResidencyPolicy`, filters by `RequiredCapabilities`, then ranks by `CostPolicy` and model tier.

---

### 4.5 ISpecializedAgent

Every agent implements this contract. `AgentOrchestratorFacade` dispatches through it.

```csharp
// EminentAi.Application/Agents/ISpecializedAgent.cs
public interface ISpecializedAgent
{
    AgentKind Kind { get; }

    /// <summary>
    /// Execute the agent turn. Yields SmartChatEvents.
    /// Must persist the assistant message BEFORE yielding done.
    /// </summary>
    IAsyncEnumerable<SmartChatEvent> ExecuteAsync(
        SmartChatContext context,
        ModelRoute route,
        CancellationToken ct);
}

public sealed record SmartChatContext(
    Guid BranchId,
    string UserText,
    IReadOnlyList<ChatAttachment> Attachments,
    RoutingDecision Routing,
    Guid AssistantMessageId   // pre-allocated so done carries the id
);
```

---

## 5. High-Level Architecture (HLD)

```mermaid
graph TB
    User(["User — Web UI"])
    Composer["Composer\n+ image attachment\n+ Auto-route toggle\n+ Manual model picker"]

    subgraph "API Layer — EminentAi.Api"
        SmartAPI["POST /api/chat/smart\nnew"]
        LegacyAPI["POST /api/branches/:id/messages\nunchanged"]
        ImageServe["GET /api/generated-images/:file\nnew — auth required"]
    end

    subgraph "Orchestration — EminentAi.Application"
        AOF["AgentOrchestratorFacade\nowns: intent → model → execute → persist → SSE"]
        IR["IntentRouter\nfast-path regex OR qwen3.5:2b\nDefensive label parse + telemetry"]
        MR["ModelRouter\nqueries all providers\nCostPolicy + DataResidencyPolicy"]
    end

    subgraph "Specialized Agents — ISpecializedAgent"
        VA["VisionAgent\nAgentProfile.Vision\nCapability: vision"]
        CA["CodeAgent\nAgentProfile.Coding\nCapability: code"]
        AA["ArchitectureAgent\nAgentProfile.Architecture\nMermaid sections enforced"]
        IGA["ImageGenerationAgent\nFlux pipeline\nCapability: image_gen"]
        GA["GeneralAgent\nAgentProfile.General\nfallback"]
    end

    subgraph "Provider Layer — IModelProvider"
        OProv["OllamaModelProvider\n(implemented)"]
        CProv["ClaudeModelProvider\n(future)"]
        GPTProv["ChatGPTModelProvider\n(future)"]
    end

    subgraph "Infrastructure — EminentAi.Infrastructure"
        OC["OllamaClient : IOllamaClient"]
        CS["ChatService\naccepts AgentProfile — not string"]
        DB[(SQLite)]
        FS[("Local FS\n/generated-images/\n.gitignored")]
    end

    User --> Composer
    Composer -->|"Smart mode"| SmartAPI
    Composer -->|"Manual mode"| LegacyAPI

    SmartAPI --> AOF
    AOF --> IR --> MR
    MR --> OProv & CProv & GPTProv
    AOF -->|"dispatch by AgentKind"| VA & CA & AA & IGA & GA
    VA & CA & AA & GA --> CS --> OC --> DB
    IGA --> OC
    IGA --> FS
    OProv --> OC

    LegacyAPI --> CS
    ImageServe -->|"auth + ownership check"| FS
    SmartAPI -->|"SSE stream"| User
    ImageServe -->|"PNG bytes"| User
```

---

## 6. Component Design (LLD)

### 6.1 AgentOrchestratorFacade

```mermaid
classDiagram
    class AgentOrchestratorFacade {
        -IIntentRouter _router
        -IModelRouter _modelRouter
        -IEnumerable~ISpecializedAgent~ _agents
        -CostPolicy _costPolicy
        -DataResidencyPolicy _residencyPolicy
        +ExecuteSmartTurnAsync(SmartTurnRequest, CancellationToken) IAsyncEnumerable~SmartChatEvent~
        -ResolveAgent(AgentKind kind) ISpecializedAgent
        -EmitError(string message) SmartChatEvent
    }

    class SmartTurnRequest {
        +Guid BranchId
        +string UserText
        +List~ChatAttachment~ Attachments
        +AgentKind? HintOverride
    }

    class SmartChatEvent {
        +string Type
        +object Data
    }

    AgentOrchestratorFacade --> IIntentRouter
    AgentOrchestratorFacade --> IModelRouter
    AgentOrchestratorFacade --> ISpecializedAgent
    AgentOrchestratorFacade ..> SmartTurnRequest
    AgentOrchestratorFacade ..> SmartChatEvent
```

`AgentOrchestratorFacade.ExecuteSmartTurnAsync` is the single entry point. It:

1. Calls `IntentRouter.RouteAsync` → `RoutingDecision`
2. Emits `routing_decision` SSE event immediately (user sees it before model warms up)
3. Calls `ModelRouter.ResolveAsync` with the profile, cost policy, and residency policy
4. If no model found → emits `routing_error` → returns
5. Resolves the correct `ISpecializedAgent` for the intent
6. Calls `agent.ExecuteAsync` — the agent streams tokens AND persists before yielding `done`
7. Propagates all yielded events to the SSE response

**Orchestration is owned here, not scattered across the endpoint.**

---

### 6.2 IntentRouterService

```mermaid
classDiagram
    class IntentRouterService {
        -IOllamaClient _ollama
        -ILogger _log
        +RouteAsync(IntentRequest, CancellationToken) Task~RoutingDecision~
        -TryFastPath(IntentRequest) AgentKind?
        -ClassifyViaLlmAsync(string text, bool hasImage, CancellationToken) Task~string~
        -ParseIntentLabel(string raw) AgentKind
        -BuildClassifyPrompt(string text, bool hasImage) string
    }

    IntentRouterService ..|> IIntentRouter
```

**Fast-path rules** (no LLM call, zero latency):

| Condition | Result |
|---|---|
| `HasImageAttachment && text matches \b(read\|extract\|what\|describe\|tell me about\|text in)\b` | `Vision` |
| `text matches ^(generate\|draw\|create a (logo\|image\|picture\|banner)\|design an? (image\|logo\|graphic)\|make an? (image\|logo))` (case-insensitive) | `ImageGeneration` |

Fast-path matches are recorded in `ClassificationRecord.WasFastPath = true`.

**`autoRouteHint` handling:** the `HintOverride` field in `IntentRequest` is parsed to `AgentKind?` by the endpoint before the call reaches `IntentRouterService`. If it is a valid `AgentKind`, the LLM call is skipped entirely and `ClassificationRecord.HintOverrideApplied = true` is set. The actual applied kind is always returned in `RoutingDecision.Intent` — the UI shows what was truly used, not the hint.

**Classification prompt** (sent to `qwen3.5:2b`, temperature 0.0, max 10 tokens):

```
You are a one-word classifier. Read the user message below and reply with
EXACTLY ONE of these labels, nothing else — no punctuation, no explanation.

VISION         — user attached an image and wants to read, extract, or analyse it
CODING         — user wants working code, a coding example, debugging, or code review
ARCHITECTURE   — user wants system design, tech stack, HLD, LLD, or diagrams
IMAGE_GEN      — user wants to generate, draw, or create an image, logo, or graphic
GENERAL        — anything else

HasImageAttachment: {true|false}
UserMessage: {userText}
```

---

### 6.3 ModelRouterService

```mermaid
classDiagram
    class ModelRouterService {
        -IEnumerable~IModelProvider~ _providers
        -ILogger _log
        +ResolveAsync(AgentProfile, CostPolicy, DataResidencyPolicy, CancellationToken) Task~ModelRoute~
        -FilterByPolicy(IReadOnlyList~ModelDescriptor~, CostPolicy, DataResidencyPolicy) IReadOnlyList~ModelDescriptor~
        -FilterByCapabilities(IReadOnlyList~ModelDescriptor~, IReadOnlySet~string~) IReadOnlyList~ModelDescriptor~
        -RankCandidates(IReadOnlyList~ModelDescriptor~, AgentProfile) IReadOnlyList~ModelDescriptor~
        -FindByNamePriority(string[] patterns, IReadOnlyList~ModelDescriptor~) ModelDescriptor?
        -FindByTierFallback(string tier, IReadOnlyList~ModelDescriptor~) ModelDescriptor?
    }

    ModelRouterService ..|> IModelRouter
    ModelRouterService --> IModelProvider
```

**Name-priority lists per `AgentKind`:**

```csharp
private static readonly IReadOnlyDictionary<AgentKind, string[]> NamePriorities = new Dictionary<AgentKind, string[]>
{
    [AgentKind.Vision]          = ["qwen2.5vl", "vl", "vision", "llava", "moondream"],
    [AgentKind.Coding]          = ["qwen2.5-coder:1.5b", "qwen2.5-coder", "coder", "deepseek-coder"],
    [AgentKind.Architecture]    = ["qwen3:latest", "qwen3", "gemma4", "qwen2.5:latest", "qwen2.5"],
    [AgentKind.ImageGeneration] = ["flux2-klein", "flux", "diffusion"],
    [AgentKind.General]         = ["qwen2.5:latest", "qwen2.5", "qwen3.5", "llama3"],
};
```

---

### 6.4 OllamaModelProvider

```mermaid
classDiagram
    class OllamaModelProvider {
        -IOllamaClient _client
        -TimeSpan _cacheExpiry
        -IReadOnlyList~ModelDescriptor~? _cache
        -DateTime _cacheAt
        +Name: string = "ollama"
        +ListModelsAsync(CancellationToken) Task~IReadOnlyList~ModelDescriptor~~
        +StreamAsync(ModelInvocation, CancellationToken) IAsyncEnumerable~ChatDelta~
        +CheckHealthAsync(CancellationToken) Task~ProviderHealth~
        -MapCapabilities(ModelInfo) IReadOnlySet~ModelCapability~
    }

    OllamaModelProvider ..|> IModelProvider
    OllamaModelProvider --> IOllamaClient
```

`ListModelsAsync` caches results for 60 seconds — model installs do not change mid-conversation.

`MapCapabilities` maps existing `ClassifyTier()` output to `ModelCapability` flags:

```
"vision"    → { Vision, TextGeneration }
"fast"      → { TextGeneration, CodeGeneration }
"balanced"  → { TextGeneration, CodeGeneration, FunctionCalling }
"reasoning" → { TextGeneration, Reasoning }
"embedding" → { Embedding }
"image_gen" → { ImageGeneration }   ← new tier added to ClassifyTier()
```

---

### 6.5 VisionAgent

```mermaid
classDiagram
    class VisionAgent {
        -ChatService _chat
        -IConversationRepository _repo
        +Kind: AgentKind = Vision
        +ExecuteAsync(SmartChatContext, ModelRoute, CancellationToken) IAsyncEnumerable~SmartChatEvent~
    }

    VisionAgent ..|> ISpecializedAgent
    VisionAgent --> ChatService
```

`ExecuteAsync`:

1. Streams `ChatService.SendMessageAsync` with `AgentProfile.Vision` injected as system prompt and model override.
2. Yields `token` events.
3. Awaits full stream completion.
4. Awaits `ChatService` to persist the assistant message to SQLite.
5. **Only then** yields `done` with `messageId`.

This fixes the v1 ordering bug where `done` was emitted before the DB write.

---

### 6.6 CodeAgent

Identical structure to `VisionAgent`, uses `AgentProfile.Coding`. Temperature 0.1 (deterministic code).

---

### 6.7 ArchitectureAgent

Identical structure, uses `AgentProfile.Architecture`. Temperature 0.3 (allows creative design variation). The system prompt enforces the Summary → HLD → LLD → Sequence → Flowchart → Justification structure with Mermaid fences. The existing `MarkdownRenderer.tsx` already renders Mermaid blocks — no frontend change needed for diagram rendering.

---

### 6.8 ImageGenerationAgent

```mermaid
classDiagram
    class ImageGenerationAgent {
        -IOllamaClient _ollama
        -IConversationRepository _repo
        -string _outputDirectory
        +Kind: AgentKind = ImageGeneration
        +ExecuteAsync(SmartChatContext, ModelRoute, CancellationToken) IAsyncEnumerable~SmartChatEvent~
        -TranslateToFluxPromptAsync(string userPrompt, CancellationToken) Task~string~
        -GenerateAndSaveAsync(string fluxModel, string fluxPrompt, CancellationToken) Task~string~
        -PersistImageMessageAsync(SmartChatContext, string imageUrl, string fluxPrompt, CancellationToken) Task~Guid~
    }

    class ImageGenerationResult {
        +string Filename
        +string ServedUrl
        +string FluxPrompt
        +string GeneratorModel
        +long GenerationMs
    }

    ImageGenerationAgent ..|> ISpecializedAgent
    ImageGenerationAgent --> IOllamaClient
    ImageGenerationAgent --> IConversationRepository
    ImageGenerationAgent ..> ImageGenerationResult
```

**Internal pipeline:**

```mermaid
flowchart LR
    A["User prompt\n'Create a minimalist logo\nfor my AI startup Eminent'"]
    B["Flux prompt translator\nqwen3.5:2b · temp 0.3"]
    C["Flux prompt string\n'minimalist logo, AI startup,\nbold sans-serif, dark bg,\nneon blue accent, vector art'"]
    D["POST /api/generate\nx/flux2-klein:4b · stream false\n⚠ spike required to verify response shape"]
    E["Base64 PNG string\n~3–6 MB"]
    F["Save to disk\n/generated-images/uuid.png"]
    G["Persist Message row\nwith image URL in content"]
    H["Yield image_generated\n+ done SSE events"]

    A --> B --> C --> D --> E --> F --> G --> H
```

**Flux prompt translation system prompt** (sent to `qwen3.5:2b`):

```
You are a Flux2 image prompt engineer. Convert the user description into a
comma-separated keyword list of 10–20 terms describing the image visually.

Rules:
- Visual attributes only: style, colours, mood, composition, medium.
- Include art style keywords: vector, digital art, photorealistic, minimalist.
- Include quality boosters when relevant: high detail, sharp, professional.
- Do NOT include negatives — Flux uses a separate negative prompt field.
- Output ONLY the prompt string. No quotes, no explanation, no prefix.

User request: {userPrompt}
```

**Ownership tracking for image auth:** when `PersistImageMessageAsync` saves the assistant message, it also writes a row to a new `GeneratedImages` table:

```sql
CREATE TABLE IF NOT EXISTS "GeneratedImages" (
    "Id"       TEXT NOT NULL PRIMARY KEY,      -- uuid = filename
    "BranchId" TEXT NOT NULL,                  -- owning branch
    "CreatedAt" TEXT NOT NULL
);
```

`GET /api/generated-images/{filename}` verifies the caller's bearer token resolves to an admin session, then checks `GeneratedImages.BranchId` belongs to a conversation accessible by that session.

---

### 6.9 GeneralAgent

Identical structure to `VisionAgent`, uses `AgentProfile.General`. Temperature 0.7. No capability requirements.

---

## 7. Sequence Diagrams

### 7.1 Flow 1 — Vision / Image Reading

```mermaid
sequenceDiagram
    actor User
    participant Web as React UI
    participant API as POST /api/chat/smart
    participant AOF as AgentOrchestratorFacade
    participant IR as IntentRouter
    participant MR as ModelRouter
    participant OProv as OllamaModelProvider
    participant VA as VisionAgent
    participant CS as ChatService
    participant OC as OllamaClient
    participant DB as SQLite

    User->>Web: Attach invoice.png + "What does this invoice say?"
    Web->>API: {branchId, content, attachments:[{base64,"image/png"}]}

    API->>AOF: ExecuteSmartTurnAsync(request)
    AOF->>IR: RouteAsync({text, hasImage:true, hint:null})
    IR->>IR: Fast-path: hasImage + "what" → Vision (no LLM call)
    IR-->>AOF: RoutingDecision{Vision, profile, classificationMs:1, wasFastPath:true}

    AOF-->>API: SmartChatEvent{routing_decision}
    API-->>Web: SSE: routing_decision {intent:"vision", model:"qwen2.5vl:latest"}

    AOF->>MR: ResolveAsync(AgentProfile.Vision, costPolicy, residencyPolicy)
    MR->>OProv: ListModelsAsync() [cached]
    OProv-->>MR: [ModelDescriptor list]
    MR-->>AOF: ModelRoute{qwen2.5vl:latest, provider:ollama, exactMatch:true}

    AOF->>VA: ExecuteAsync(context, route, ct)

    VA->>CS: SendMessageAsync(branchId, text, attachments, model, AgentProfile.Vision)
    CS->>OC: ChatStreamAsync(qwen2.5vl, [system:vision, history, user+images])
    loop streaming tokens
        OC-->>CS: ChatDelta{token}
        CS-->>VA: ChatDelta{token}
        VA-->>AOF: SmartChatEvent{token}
        AOF-->>API: SmartChatEvent{token}
        API-->>Web: SSE: token {text}
    end
    OC-->>CS: ChatDelta{done, usage}

    CS->>DB: INSERT Message (assistantMessage, fullContent)
    DB-->>CS: saved
    Note over CS,DB: Persist FIRST — then signal done

    CS-->>VA: MessageId
    VA-->>AOF: SmartChatEvent{persisted, messageId}
    AOF-->>API: SmartChatEvent{done, messageId}
    API-->>Web: SSE: done {messageId, tokensUsed}
```

---

### 7.2 Flow 2 — Code Request

```mermaid
sequenceDiagram
    actor User
    participant Web as React UI
    participant API as POST /api/chat/smart
    participant AOF as AgentOrchestratorFacade
    participant IR as IntentRouter
    participant OC_C as OllamaClient (qwen3.5:2b — classifier)
    participant MR as ModelRouter
    participant CA as CodeAgent
    participant CS as ChatService
    participant OC_M as OllamaClient (qwen2.5-coder:1.5b)
    participant DB as SQLite

    User->>Web: "Show me a real-world Saga pattern in C# with compensating transactions"
    Web->>API: {branchId, content}

    API->>AOF: ExecuteSmartTurnAsync(request)
    AOF->>IR: RouteAsync({text, hasImage:false, hint:null})
    IR->>IR: No fast-path match
    IR->>OC_C: ChatOnceAsync(qwen3.5:2b, classifyPrompt, temp:0.0)
    OC_C-->>IR: "CODING"
    IR->>IR: ParseIntentLabel("CODING") → AgentKind.Coding
    IR-->>AOF: RoutingDecision{Coding, profile, rawLabel:"CODING", classificationMs:420}

    AOF-->>API: SmartChatEvent{routing_decision}
    API-->>Web: SSE: routing_decision {intent:"coding", model:"qwen2.5-coder:1.5b"}

    AOF->>MR: ResolveAsync(AgentProfile.Coding, ...)
    MR-->>AOF: ModelRoute{qwen2.5-coder:1.5b, provider:ollama}

    AOF->>CA: ExecuteAsync(context, route, ct)
    CA->>CS: SendMessageAsync(branchId, text, model, AgentProfile.Coding)
    CS->>OC_M: ChatStreamAsync(qwen2.5-coder:1.5b, [system:coding, history, user])
    loop streaming code
        OC_M-->>CA: ChatDelta{token}
        CA-->>AOF: SmartChatEvent{token}
        API-->>Web: SSE: token {text}
    end
    OC_M-->>CS: ChatDelta{done}
    CS->>DB: INSERT Message
    DB-->>CS: saved
    CS-->>CA: MessageId
    CA-->>AOF: SmartChatEvent{done, messageId}
    API-->>Web: SSE: done {messageId}
```

---

### 7.3 Flow 3 — Architecture & Design

```mermaid
sequenceDiagram
    actor User
    participant Web as React UI
    participant API as POST /api/chat/smart
    participant AOF as AgentOrchestratorFacade
    participant IR as IntentRouter
    participant MR as ModelRouter
    participant AA as ArchitectureAgent
    participant CS as ChatService
    participant OC as OllamaClient (qwen3:latest)
    participant DB as SQLite

    User->>Web: "Design a microservices e-commerce platform with React, .NET 10, Redis, PostgreSQL"
    Web->>API: {branchId, content}

    API->>AOF: ExecuteSmartTurnAsync(request)
    AOF->>IR: RouteAsync({text, hasImage:false, hint:null})
    IR->>IR: No fast-path match
    IR->>OC: ChatOnceAsync(qwen3.5:2b, classifyPrompt)
    OC-->>IR: "ARCHITECTURE"
    IR-->>AOF: RoutingDecision{Architecture, AgentProfile.Architecture}

    AOF-->>API: SmartChatEvent{routing_decision}
    API-->>Web: SSE: routing_decision {intent:"architecture", model:"qwen3:latest"}

    AOF->>MR: ResolveAsync(AgentProfile.Architecture, ...)
    MR-->>AOF: ModelRoute{qwen3:latest, provider:ollama, isExactMatch:true}

    AOF->>AA: ExecuteAsync(context, route, ct)
    AA->>CS: SendMessageAsync(branchId, text, model, AgentProfile.Architecture)
    CS->>OC: ChatStreamAsync(qwen3:latest, [system:arch-prompt, history, user])
    loop streaming — HLD + LLD + sequence + flowchart sections
        OC-->>AA: ChatDelta{token}
        AA-->>AOF: SmartChatEvent{token}
        API-->>Web: SSE: token {text}
        Note over Web: MarkdownRenderer renders\nMermaid fences as live diagrams
    end
    OC-->>CS: ChatDelta{done}

    CS->>DB: INSERT Message
    DB-->>CS: saved
    CS-->>AA: MessageId
    AA-->>AOF: SmartChatEvent{done, messageId}
    API-->>Web: SSE: done {messageId}
    Web-->>User: Rendered HLD + LLD + sequence + flowchart + justification
```

---

### 7.4 Flow 4 — Image Generation

```mermaid
sequenceDiagram
    actor User
    participant Web as React UI
    participant API as POST /api/chat/smart
    participant AOF as AgentOrchestratorFacade
    participant IR as IntentRouter
    participant MR as ModelRouter
    participant IGA as ImageGenerationAgent
    participant OC_T as OllamaClient (qwen3.5:2b — translator)
    participant OC_F as OllamaClient (flux2-klein — generator)
    participant FS as Local Filesystem
    participant DB as SQLite

    User->>Web: "Generate a minimalist logo for my AI startup called Eminent"
    Web->>API: {branchId, content}

    API->>AOF: ExecuteSmartTurnAsync(request)
    AOF->>IR: RouteAsync({text, hasImage:false, hint:null})
    IR->>IR: Fast-path: "Generate a ... logo" → IMAGE_GEN
    IR-->>AOF: RoutingDecision{ImageGeneration, AgentProfile.ImageGeneration, wasFastPath:true}

    AOF-->>API: SmartChatEvent{routing_decision}
    API-->>Web: SSE: routing_decision {intent:"imageGeneration", model:"x/flux2-klein:4b"}

    AOF->>MR: ResolveAsync(AgentProfile.ImageGeneration, ...)
    MR-->>AOF: ModelRoute{x/flux2-klein:4b, provider:ollama}

    AOF->>IGA: ExecuteAsync(context, route, ct)

    IGA-->>AOF: SmartChatEvent{image_gen_progress, stage:"translating"}
    API-->>Web: SSE: image_gen_progress {stage:"translating"}

    IGA->>OC_T: ChatOnceAsync(qwen3.5:2b, flux-prompt-engineer, userPrompt, temp:0.3)
    OC_T-->>IGA: "minimalist logo, AI startup, bold sans-serif, dark bg, neon blue accent, vector"

    IGA-->>AOF: SmartChatEvent{image_gen_progress, stage:"generating", fluxPrompt}
    API-->>Web: SSE: image_gen_progress {stage:"generating", fluxPrompt}

    IGA->>OC_F: GenerateImageAsync(flux2-klein, fluxPrompt)
    Note over IGA,OC_F: POST /api/generate · stream:false · 30–120s
    OC_F-->>IGA: base64 PNG string (⚠ shape unverified — spike required)

    IGA-->>AOF: SmartChatEvent{image_gen_progress, stage:"saving"}
    API-->>Web: SSE: image_gen_progress {stage:"saving"}

    IGA->>FS: write /generated-images/uuid.png
    FS-->>IGA: saved

    IGA->>DB: INSERT GeneratedImages(id:uuid, branchId, createdAt)
    IGA->>DB: INSERT Message(content:"[generated image](url)", model:flux2-klein)
    DB-->>IGA: saved

    Note over IGA,DB: Persist BOTH records before done

    IGA-->>AOF: SmartChatEvent{image_generated, url, fluxPrompt, filename}
    API-->>Web: SSE: image_generated {url, fluxPrompt, filename, generationMs}

    IGA-->>AOF: SmartChatEvent{done, messageId}
    API-->>Web: SSE: done {messageId}

    Web-->>User: Inline PNG + Download + Copy URL + expandable Flux prompt
```

---

### 7.5 Flow 5 — General Request

```mermaid
sequenceDiagram
    actor User
    participant Web as React UI
    participant API as POST /api/chat/smart
    participant AOF as AgentOrchestratorFacade
    participant IR as IntentRouter
    participant MR as ModelRouter
    participant GA as GeneralAgent
    participant CS as ChatService
    participant OC as OllamaClient (qwen2.5:latest)
    participant DB as SQLite

    User->>Web: "What is the difference between REST and GraphQL?"
    Web->>API: {branchId, content}

    API->>AOF: ExecuteSmartTurnAsync(request)
    AOF->>IR: RouteAsync({text, hasImage:false, hint:null})
    IR->>OC: ChatOnceAsync(qwen3.5:2b, classifyPrompt)
    OC-->>IR: "GENERAL"
    IR-->>AOF: RoutingDecision{General, AgentProfile.General}

    AOF-->>API: SmartChatEvent{routing_decision}
    API-->>Web: SSE: routing_decision {intent:"general", model:"qwen2.5:latest"}

    AOF->>MR: ResolveAsync(AgentProfile.General, ...)
    MR-->>AOF: ModelRoute{qwen2.5:latest, provider:ollama}

    AOF->>GA: ExecuteAsync(context, route, ct)
    GA->>CS: SendMessageAsync(branchId, text, model, AgentProfile.General)
    CS->>OC: ChatStreamAsync(qwen2.5:latest, [system, history, user])
    loop tokens
        OC-->>GA: ChatDelta{token}
        GA-->>AOF: SmartChatEvent{token}
        API-->>Web: SSE: token {text}
    end
    OC-->>CS: ChatDelta{done}
    CS->>DB: INSERT Message
    DB-->>CS: saved
    CS-->>GA: MessageId
    GA-->>AOF: SmartChatEvent{done, messageId}
    API-->>Web: SSE: done {messageId}
```

---

### 7.6 Flow 6 — Intent Classification (Internal)

Shows the full internal logic of `IntentRouterService.RouteAsync` including telemetry and defensive parsing.

```mermaid
sequenceDiagram
    participant Caller as AgentOrchestratorFacade
    participant IR as IntentRouterService
    participant FP as FastPathCheck (regex)
    participant OC as OllamaClient (qwen3.5:2b)
    participant Log as ILogger

    Caller->>IR: RouteAsync(IntentRequest)

    alt HintOverride is valid AgentKind
        IR->>IR: Apply hint, skip LLM call
        IR->>Log: Log{hintApplied:true, kind:X}
    else No hint
        IR->>FP: hasImage && text matches vision keywords?
        alt Fast-path vision match
            FP-->>IR: AgentKind.Vision
            IR->>Log: Log{fastPath:"vision"}
        else
            IR->>FP: text matches image gen keywords?
            alt Fast-path image gen match
                FP-->>IR: AgentKind.ImageGeneration
                IR->>Log: Log{fastPath:"imageGen"}
            else
                IR->>OC: ChatOnceAsync(qwen3.5:2b, classifyPrompt, temp:0.0, maxTokens:10)
                OC-->>IR: raw string e.g. "  CODING\n"
                IR->>IR: ParseIntentLabel → trim → uppercase → enum match
                IR->>Log: Log{rawLabel:"  CODING\n", parsed:Coding, wasFastPath:false}
                alt Unknown label
                    IR->>IR: Default to General
                    IR->>Log: Warn{unknownLabel:"XYZ", defaultedTo:General}
                end
            end
        end
    end

    IR-->>Caller: RoutingDecision{intent, profile, telemetry:ClassificationRecord}
```

---

### 7.7 Flow 7 — Provider Fallback Chain

Shows how `ModelRouter` behaves when the preferred local model is unavailable.

```mermaid
sequenceDiagram
    participant AOF as AgentOrchestratorFacade
    participant MR as ModelRouterService
    participant OProv as OllamaModelProvider
    participant CProv as ClaudeModelProvider (future)
    participant Log as ILogger

    AOF->>MR: ResolveAsync(AgentProfile.Architecture, costPolicy{preferLocal:true}, residency{localOnly:false})

    MR->>OProv: CheckHealthAsync()
    OProv-->>MR: ProviderHealth{healthy:true}

    MR->>OProv: ListModelsAsync()
    OProv-->>MR: [ModelDescriptor list — no qwen3 installed in this example]

    MR->>MR: FilterByCapability(TextGeneration) → all pass
    MR->>MR: FindByNamePriority([qwen3, gemma4, qwen2.5]) → no qwen3, no gemma4
    MR->>MR: FindByNamePriority → qwen2.5:latest found
    MR->>Log: Log{intent:Architecture, preferred:"qwen3:latest", actualSelected:"qwen2.5:latest", reason:"name fallback 3"}
    MR-->>AOF: ModelRoute{qwen2.5:latest, provider:ollama, isExactMatch:false, reason:"qwen3 not installed — fell back to qwen2.5:latest"}

    Note over MR,CProv: If CostPolicy.PreferLocal is false AND ClaudeModelProvider is registered,\nClaude Sonnet would be evaluated here before the fallback completes.
```

---

## 8. Overall Orchestration Flowchart

```mermaid
flowchart TD
    Start(["User message\nPOST /api/chat/smart"])

    Start --> HintCheck{autoRouteHint\nprovided?}
    HintCheck -->|"Valid AgentKind"| HintApply["Use hint directly\nskip LLM classify\nhintOverrideApplied = true"]
    HintCheck -->|"null / invalid"| HasImg{Has image\nattachment?}

    HasImg -->|"Yes"| FastV{"Text matches\nvision keywords?"}
    HasImg -->|"No"| FastIG{"Text matches\nimage gen keywords?"}

    FastV -->|"Yes"| KVision["AgentKind = Vision\nwasFastPath = true"]
    FastV -->|"No"| LlmClassify["ChatOnceAsync\nqwen3.5:2b · max 10 tokens"]

    FastIG -->|"Yes"| KImgGen["AgentKind = ImageGeneration\nwasFastPath = true"]
    FastIG -->|"No"| LlmClassify

    HintApply --> KVision & KCoding["AgentKind = Coding"] & KArch["AgentKind = Architecture"] & KImgGen & KGeneral["AgentKind = General"]

    LlmClassify --> DefensiveParse["ParseIntentLabel\ntrim → uppercase → enum match\nunknown → General + log warn"]
    DefensiveParse --> KVision & KCoding & KArch & KImgGen & KGeneral

    KVision & KCoding & KArch & KImgGen & KGeneral --> AgentProfile["Lookup AgentProfile.ForKind()\nserver-side constant only"]
    AgentProfile --> EmitRouting["SSE: routing_decision\n{intent, model, reason, wasFastPath}"]

    EmitRouting --> ModelRouter["ModelRouter.ResolveAsync\nquery providers → filter cap → rank"]
    ModelRouter --> NoModel{Model\nfound?}
    NoModel -->|"No"| ErrModel["SSE: routing_error\n{intent, ollamaPullCommand}"]

    NoModel -->|"Yes"| DispatchAgent{Dispatch by\nAgentKind}

    DispatchAgent -->|"Vision"| AgentVision["VisionAgent\nstream → WAIT persist → done"]
    DispatchAgent -->|"Coding"| AgentCode["CodeAgent\nstream → WAIT persist → done"]
    DispatchAgent -->|"Architecture"| AgentArch["ArchitectureAgent\nstream → WAIT persist → done"]
    DispatchAgent -->|"General"| AgentGeneral["GeneralAgent\nstream → WAIT persist → done"]
    DispatchAgent -->|"ImageGeneration"| FluxCheck{flux model\navailable?}

    FluxCheck -->|"No"| ErrFlux["SSE: routing_error\nInstall: ollama pull x/flux2-klein:4b"]
    FluxCheck -->|"Yes"| SpikeOK{Flux API\nspike verified?}
    SpikeOK -->|"No"| ErrSpike["Block: run spike first\ncurl /api/generate test"]
    SpikeOK -->|"Yes"| AgentImgGen["ImageGenerationAgent\ntranslate → generate → save\n→ persist GeneratedImages + Message\n→ done"]

    AgentVision & AgentCode & AgentArch & AgentGeneral --> PersistDone["ChatService persists\nMessage to SQLite\nTHEN emits done"]
    AgentImgGen --> PersistDoneImg["Persist Message + GeneratedImages\nTHEN emits image_generated + done"]

    PersistDone & PersistDoneImg --> SSEDone["SSE: done {messageId}\nclient can now safely reload"]
```

---

## 9. Smart Endpoint Contract

### Request

```
POST /api/chat/smart
Authorization: Bearer <session-token>
Content-Type: application/json

{
  "branchId": "guid",
  "content": "string — user's message text",
  "attachments": [                              // optional
    {
      "name": "invoice.png",
      "contentType": "image/png",
      "dataBase64": "iVBORw0KGgo..."            // base64, no data-URL prefix
    }
  ],
  "autoRouteHint": "vision|coding|architecture|imageGeneration|general"
                                                // optional; validated to AgentKind enum
                                                // advisory — actual route returned in routing_decision
}
```

### SSE Event Stream

```
── always first: ─────────────────────────────────────────────

event: routing_decision
data: {
  "intent": "vision",
  "model": "qwen2.5vl:latest",
  "provider": "ollama",
  "reason": "fast-path: image attached and text contains 'what'",
  "classificationMs": 1,
  "wasFastPath": true,
  "hintOverrideApplied": false
}

── for text responses (Vision / Code / Architecture / General): ─

event: token
data: { "text": "The invoice shows a total of £1,234.56..." }

── persist happens here (invisible to client) ────────────────

event: done
data: { "messageId": "guid", "tokensIn": 312, "tokensOut": 89 }

── for image generation: ─────────────────────────────────────

event: image_gen_progress
data: { "stage": "translating" }

event: image_gen_progress
data: {
  "stage": "generating",
  "fluxPrompt": "minimalist logo, AI startup, bold sans-serif, neon blue accent..."
}

event: image_gen_progress
data: { "stage": "saving" }

── persist happens here (invisible to client) ────────────────

event: image_generated
data: {
  "url": "/api/generated-images/3f7a9b2e-1234-5678-abcd-ef1234567890.png",
  "filename": "3f7a9b2e-1234-5678-abcd-ef1234567890.png",
  "fluxPrompt": "minimalist logo, AI startup, bold sans-serif...",
  "generationMs": 47320
}

event: done
data: { "messageId": "guid" }

── on error: ─────────────────────────────────────────────────

event: routing_error
data: {
  "intent": "imageGeneration",
  "message": "No image generation model installed.",
  "ollamaPullCommand": "ollama pull x/flux2-klein:4b"
}
```

### Generated Image Serve Endpoint

```
GET /api/generated-images/{filename}
Authorization: Bearer <session-token>     ← required; same auth as all other endpoints
```

- `filename` validated against `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$`.
- `Path.GetFullPath` check confirms resolved path is within `generated-images/` directory.
- Ownership verified: `GeneratedImages.BranchId` must belong to a conversation accessible to the session.
- `Content-Type: image/png` always set explicitly; never inferred from extension.
- Returns 400 for invalid filename, 401 for no/invalid session, 403 for ownership mismatch, 404 if file not found.

---

## 10. New SSE Event Types

| Event | Emitted by | When | Required fields |
|---|---|---|---|
| `routing_decision` | `AgentOrchestratorFacade` | Always, before first token | `intent`, `model`, `provider`, `reason`, `classificationMs`, `wasFastPath`, `hintOverrideApplied` |
| `image_gen_progress` | `ImageGenerationAgent` | 3× during generation | `stage` ("translating" / "generating" / "saving"); `fluxPrompt` on "generating" |
| `image_generated` | `ImageGenerationAgent` | After PNG saved AND persisted | `url`, `filename`, `fluxPrompt`, `generationMs` |
| `routing_error` | `AgentOrchestratorFacade` | When no model resolved | `intent`, `message`, `ollamaPullCommand`? |

Existing events (`token`, `done`, `error`) are unchanged. Ordering guarantee: `done` is **always** emitted after both stream completion and durable DB persistence.

---

## 11. Backend File Map

### New files

```
src/EminentAi.Application/
├── Agents/
│   ├── AgentKind.cs                       ← enum: Vision Coding Architecture ImageGeneration General
│   ├── AgentProfile.cs                    ← sealed record: Kind, SystemPrompt, Temperature, RequiredCapabilities
│   ├── AgentProfiles.cs                   ← static class: server-side constants, ForKind(AgentKind)
│   ├── ISpecializedAgent.cs               ← interface: Kind, ExecuteAsync(context, route, ct)
│   ├── SmartChatContext.cs                ← record: BranchId, UserText, Attachments, Routing, AssistantMessageId
│   ├── SmartChatEvent.cs                  ← record: Type, Data
│   ├── VisionAgent.cs
│   ├── CodeAgent.cs
│   ├── ArchitectureAgent.cs
│   ├── GeneralAgent.cs
│   └── ImageGeneration/
│       ├── ImageGenerationAgent.cs
│       └── ImageGenerationResult.cs       ← record: Filename, ServedUrl, FluxPrompt, GeneratorModel, GenerationMs
│
├── Routing/
│   ├── IIntentRouter.cs                   ← interface: RouteAsync
│   ├── IntentRequest.cs                   ← record: UserText, HasImageAttachment, ContentTypes, HintOverride
│   ├── RoutingDecision.cs                 ← record: Intent, Profile, ModelRoute, ClassifierModel, Ms, Telemetry
│   ├── ClassificationRecord.cs            ← record: RawLabel, WasFastPath, ConfidenceHint, HintOverrideApplied
│   ├── IModelRouter.cs                    ← interface: ResolveAsync
│   └── ModelRoute.cs                      ← record: Model, ProviderName, Profile, SelectionReason, IsExactMatch
│
└── Orchestration/
    └── AgentOrchestratorFacade.cs         ← owns full turn: intent → model → agent → persist → SSE

src/EminentAi.Infrastructure/
├── Providers/
│   ├── IModelProvider.cs                  ← interface: Name, ListModelsAsync, StreamAsync, CheckHealthAsync
│   ├── ModelDescriptor.cs                 ← record: Name, ProviderName, Capabilities, SizeBytes, Tier, IsAvailable
│   ├── ModelCapability.cs                 ← enum: TextGeneration Vision ImageGeneration Embedding Reasoning ...
│   ├── ModelInvocation.cs                 ← record: ModelName, Messages, Profile, ImageBase64
│   ├── ProviderHealth.cs                  ← record: ProviderName, IsHealthy, ErrorMessage, CheckedAt
│   ├── CostPolicy.cs                      ← record: PreferLocal, MaxCostPerTokenUsd, BlockedProviders
│   ├── DataResidencyPolicy.cs             ← record: LocalOnly, AllowedRegions
│   └── OllamaModelProvider.cs             ← implements IModelProvider via IOllamaClient
│
└── Routing/
    ├── IntentRouterService.cs             ← fast-path + qwen3.5:2b + defensive parse + telemetry
    └── ModelRouterService.cs              ← multi-provider ranking, capability filter, name priority
```

### Modified files

```
src/EminentAi.Application/Abstractions/IOllamaClient.cs
  + Task<string> GenerateImageAsync(string model, string prompt, CancellationToken ct)
  // ⚠ implement only AFTER running the Flux API spike to confirm response shape

src/EminentAi.Infrastructure/Ollama/OllamaClient.cs
  + GenerateImageAsync → POST /api/generate {model, prompt, stream:false}
  + ClassifyTier() updated: add "image_gen" tier for models matching *flux* or *diffusion*

src/EminentAi.Application/Chat/ChatService.cs
  + SendMessageAsync accepts AgentProfile? profile (not string)
  + BuildContext uses profile.SystemPrompt when profile is not null, otherwise conversation.SystemPrompt

src/EminentAi.Api/Program.cs
  + Register IIntentRouter, IModelRouter, IModelProvider (OllamaModelProvider)
  + Register all ISpecializedAgent implementations
  + Register AgentOrchestratorFacade
  + Register CostPolicy and DataResidencyPolicy (from config)
  + POST /api/chat/smart → AOF.ExecuteSmartTurnAsync → SSE
  + GET  /api/generated-images/{filename} → auth + ownership + file serve
  + Bootstrap: CREATE TABLE IF NOT EXISTS "GeneratedImages" ...

src/EminentAi.Infrastructure/Persistence/EminentAiDbContext.cs
  + DbSet<GeneratedImage> GeneratedImages

src/EminentAi.Domain/Models.cs
  + class GeneratedImage { Id, BranchId, CreatedAt }
```

---

## 12. Frontend File Map

### New files

```
web/src/
├── components/
│   ├── RoutingBadge.tsx          ← pill: "Vision • qwen2.5vl:latest" with intent icon + fade-in
│   └── GeneratedImage.tsx        ← inline image + Download + Copy URL + expandable Flux prompt
└── lib/
    └── intentMeta.ts             ← intent → { label, icon, badgeColor } mapping
```

### Modified files

```
web/src/lib/api.ts
  + smartChat(branchId, content, attachments?, hint?, onEvent): Promise<void>

web/src/lib/types.ts
  + RoutingDecision, ImageGenerationResult, SmartChatEvent union type

web/src/state/store.ts
  + routingDecision?: RoutingDecision   on Message
  + generatedImageUrl?: string           on Message
  + generatedFluxPrompt?: string         on Message

web/src/components/ChatMessage.tsx
  + Render <RoutingBadge> when message.routingDecision exists
  + Render <GeneratedImage> when message.generatedImageUrl exists

web/src/components/ChatView.tsx
  + Handle: routing_decision, token, image_gen_progress, image_generated, done, routing_error
  + Show progress indicator during image generation stages

web/src/components/Composer.tsx
  + Auto-route toggle (default: ON)
  + When ON: call smartChat(); when OFF: call existing sendMessage()
  + Image attached → set hint to "vision" automatically
```

### RoutingBadge design

```
┌─────────────────────────────────┐
│  👁 Vision  •  qwen2.5vl:latest │   purple background
│  </> Code   •  qwen2.5-coder    │   blue background
│  🗺 Arch    •  qwen3:latest     │   green background
│  🎨 Image   •  flux2-klein:4b   │   orange background
│  💬 General •  qwen2.5:latest   │   grey background
└─────────────────────────────────┘
Appears below the user message, above the assistant reply.
Fades in with 200ms opacity transition.
Shows provider name when non-Ollama: "Vision • claude-3-5-sonnet (Claude)"
```

### GeneratedImage component

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│          [Generated PNG — rendered inline]           │
│          max-width: 512px, border-radius: 8px        │
│          Loading spinner during image_gen_progress   │
│                                                      │
├──────────────────────────────────────────────────────┤
│  [↓ Download]   [⧉ Copy URL]   [▾ Flux prompt]     │
├──────────────────────────────────────────────────────┤
│  minimalist logo, AI startup, bold sans-serif,       │  ← expandable, collapsed by default
│  neon blue accent, vector art, professional...       │
└──────────────────────────────────────────────────────┘
```

---

## 13. Changes to Existing Files

| File | What Changes | Why |
|---|---|---|
| [IOllamaClient.cs](../src/EminentAi.Application/Abstractions/IOllamaClient.cs) | Add `GenerateImageAsync` | Flux2 uses `/api/generate`, not `/api/chat` — after Flux spike |
| [OllamaClient.cs](../src/EminentAi.Infrastructure/Ollama/OllamaClient.cs) | Implement `GenerateImageAsync`; update `ClassifyTier` for `image_gen` | After spike to confirm response shape |
| [ChatService.cs](../src/EminentAi.Application/Chat/ChatService.cs) | Accept `AgentProfile?` not `string?` | Prevents raw string injection; server-side constants only |
| [EminentAiDbContext.cs](../src/EminentAi.Infrastructure/Persistence/EminentAiDbContext.cs) | Add `GeneratedImages` DbSet | Image ownership verification for auth |
| [Models.cs](../src/EminentAi.Domain/Models.cs) | Add `GeneratedImage` entity | DB-backed image ownership |
| [Program.cs](../src/EminentAi.Api/Program.cs) | New DI registrations, 2 new endpoints, bootstrap SQL | Wire entire new layer |
| [store.ts](../web/src/state/store.ts) | Add routing fields to Message | Badge survives re-renders |
| [ChatView.tsx](../web/src/components/ChatView.tsx) | Handle 4 new SSE event types | Routing badge, image display, progress, errors |
| [ChatMessage.tsx](../web/src/components/ChatMessage.tsx) | Render `RoutingBadge` + `GeneratedImage` | Message-level routing metadata |
| [Composer.tsx](../web/src/components/Composer.tsx) | Auto-route toggle | Smart vs manual mode switch |

---

## 14. Implementation Order

**Principle:** build the routing + text path first, validate it end-to-end, then add image generation after running the Flux spike. Never block text routing on the image pipeline.

```mermaid
gantt
    title Implementation Sequence (v2)
    dateFormat  X
    axisFormat  Step %s

    section Spike First
    Flux /api/generate spike: verify response shape          :crit, s1, 1, 2

    section Core Contracts
    AgentKind · AgentProfile · AgentProfiles (constants)    :b1, 2, 3
    ISpecializedAgent · SmartChatContext · SmartChatEvent    :b2, 3, 4
    IModelProvider · ModelDescriptor · ModelCapability       :b3, 4, 5
    IIntentRouter · IntentRequest · RoutingDecision          :b4, 5, 6
    IModelRouter · ModelRoute · CostPolicy · DataResidency   :b5, 6, 7

    section Routing Layer
    IntentRouterService (fast-path + qwen3.5:2b + parse + log)  :b6, 7, 8
    OllamaModelProvider (wraps IOllamaClient)                    :b7, 8, 9
    ModelRouterService (multi-provider rank + fallback)          :b8, 9, 10

    section Text Agents
    ChatService: AgentProfile param (not string)             :b9, 10, 11
    VisionAgent · CodeAgent · ArchitectureAgent · General    :b10, 11, 12
    AgentOrchestratorFacade                                  :b11, 12, 13

    section API — Text Path
    POST /api/chat/smart (text intents only)                 :b12, 13, 14
    DI registration in Program.cs                            :b13, 14, 15

    section Frontend — Text Path
    types.ts · api.ts smartChat()                            :f1, 15, 16
    store.ts routing fields on Message                       :f2, 16, 17
    RoutingBadge.tsx · ChatMessage.tsx · ChatView.tsx        :f3, 17, 18
    Composer.tsx auto-route toggle                           :f4, 18, 19

    section Image Generation (after spike)
    IOllamaClient + GenerateImageAsync (spike result)        :b14, 19, 20
    OllamaClient implements GenerateImageAsync               :b15, 20, 21
    GeneratedImage entity + DB table + ownership check       :b16, 21, 22
    ImageGenerationAgent (translate + generate + save)       :b17, 22, 23
    GET /api/generated-images/:file (auth + ownership)       :b18, 23, 24
    GeneratedImage.tsx frontend component                    :f5, 24, 25
```

---

## 15. Model Fallback Matrix

| Intent | Preferred | Fallback 1 | Fallback 2 | No model found |
|---|---|---|---|---|
| Vision | `qwen2.5vl:latest` | Any `*vl*` name | Any `vision` capability model | `routing_error` — include `ollama pull qwen2.5vl` |
| Coding | `qwen2.5-coder:1.5b` | Any `*coder*` name | Any `fast` tier model | Any `balanced` tier model |
| Architecture | `qwen3:latest` | `gemma4:e4b` | `qwen2.5:latest` | Largest `balanced` tier model |
| ImageGeneration | `x/flux2-klein:4b` | Any `*flux*` name | Any `image_gen` tier | `routing_error` — include `ollama pull x/flux2-klein:4b` |
| General | `qwen2.5:latest` | Any `balanced` tier | Any `fast` tier | Any installed model |

When a future `ClaudeModelProvider` is registered and `CostPolicy.PreferLocal = false`, the router will evaluate Claude's `ModelDescriptor` candidates before the local tier-fallback path. The fallback matrix above applies only to the Ollama provider.

---

## 16. Security Considerations

### System prompt — no raw string override

`ChatService.SendMessageAsync` accepts `AgentProfile? profile`. The profile's `SystemPrompt` is a compile-time constant defined in `AgentProfiles.cs`. No path from user input, HTTP body, query string, or tool result ever reaches `SystemPrompt`. The old `string? systemPromptOverride` approach was removed in this revision because it could not be enforced at the call site.

### Generated image auth and ownership

`GET /api/generated-images/{filename}` is **not** open. It requires the same bearer token as all other authenticated endpoints. After token validation, the endpoint checks `GeneratedImages` table: `BranchId` must belong to a conversation accessible to that session. A valid session holder cannot access images generated in another session's branch.

### Filename validation — two independent layers

```csharp
// Layer 1: regex — rejects anything that is not a UUID .png
if (!Regex.IsMatch(filename, @"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$"))
    return Results.BadRequest();

// Layer 2: path containment — defence in depth against regex edge cases
var resolved = Path.GetFullPath(Path.Combine(outputDir, filename));
if (!resolved.StartsWith(outputDir, StringComparison.OrdinalIgnoreCase))
    return Results.BadRequest();
```

### Classifier output is never trusted as instructions

`ParseIntentLabel` strips everything except `[A-Z_]` after uppercasing. It matches against a closed enum. Unknown labels default to `General`. The raw label is logged but never passed into a system prompt, SQL query, file path, or tool argument.

### Flux prompt subject to PII redaction

The translated Flux prompt is user-visible and stored in SQLite. It passes through `IPiiRedactor` before persistence, same as all other message content.

### `generated-images/` excluded from version control

Add to `.gitignore`:

```gitignore
# AI-generated images — local only, not committed
src/EminentAi.Api/generated-images/
web/public/generated-images/
**/generated-images/*.png
```

---

## 17. Operational Notes

### VRAM management and model warm-up

Ollama swaps models to fit VRAM. With `keep_alive: "10m"` already in `OllamaClient.BuildPayload`, the classifier (`qwen3.5:2b`) and the last-used chat model stay warm between turns. However:

- `flux2-klein:4b` requires a full model swap — the first image generation after any text exchange will have a 5–15 second cold-start before diffusion begins. The `image_gen_progress {stage:"generating"}` SSE event arrives before this delay, which is why it is mandatory UX.
- On 16 GB machines, `gemma4:e4b` (9.6 GB) may force unloading everything else. Monitor `/api/ollama` loaded models and add a warning badge in the UI if a large model will require a swap.

### Classifier telemetry corpus

To detect silent misrouting (unknown label defaulting to `General`), maintain a test corpus:

```json
// /tests/IntentRouterTests/routing-corpus.json
[
  { "text": "generate a dark mode logo for TechCorp", "expected": "ImageGeneration" },
  { "text": "show me a real-world repository pattern in .NET", "expected": "Coding" },
  { "text": "design a CQRS system for an e-commerce API", "expected": "Architecture" },
  { "text": "what does this receipt say?", "hasImage": true, "expected": "Vision" },
  { "text": "explain what recursion is", "expected": "General" }
]
```

Run this corpus in a unit test against `IntentRouterService` to catch regressions when the classifier model changes.

### Adding a new provider (e.g. Claude)

1. Create `ClaudeModelProvider : IModelProvider` in `EminentAi.Infrastructure/Providers/`.
2. Register it in DI.
3. Add `"claude"` to `CostPolicy.BlockedProviders` if local-only is preferred.
4. No other code changes — `ModelRouterService` queries all registered providers automatically.

---

*Document version: 2.0 — 2026-06-14*
*Supersedes version 1.0 — all v1 findings addressed.*
