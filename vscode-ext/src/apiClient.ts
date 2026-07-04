export type ChatMsg = { role: string; content: string };
export type ChatEvent =
  | { type: "token"; text: string }
  | { type: "done"; usage: { out: number } }
  | { type: "error"; message: string };

export type AgentEvent = {
  type: string;
  stepId?: string;
  tool?: string;
  args?: unknown;
  text?: string;
  answer?: string;
  reason?: string;
  message?: string;
  result?: string;
  error?: string;
  runId?: string;
};

export type LoginResult = {
  token: string;
  admin: {
    id: string;
    fullName: string;
    email: string;
  };
};

type SseFrame = { event: string; data: Record<string, unknown> };
type BackendModel = { name: string; tier: string };
type OllamaTag = { name: string };

/** Parses a fetch Response body as Server-Sent Events. */
async function* readSse(r: Response): AsyncGenerator<SseFrame> {
  if (!r.body) { return; }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let eventType = "message";

  while (true) {
    const { done, value } = await reader.read();
    if (done) { break; }
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trimEnd();
      buf = buf.slice(nl + 1);
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(line.slice(6)) as unknown;
          const data = isRecord(parsed) ? parsed : {};
          yield { event: eventType, data };
        }
        catch { /* skip malformed frame */ }
        eventType = "message";
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isBackendModel(value: unknown): value is BackendModel {
  return isRecord(value) && typeof value.name === "string" && typeof value.tier === "string";
}

function isOllamaTag(value: unknown): value is OllamaTag {
  return isRecord(value) && typeof value.name === "string";
}

export class ApiClient {
  constructor(
    private backendUrl: () => string,
    private ollamaUrl: () => string,
    private authToken: () => Thenable<string | undefined>
  ) {}

  private async backendHeaders(contentType = false): Promise<HeadersInit> {
    const token = await this.authToken();
    return {
      ...(contentType ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.backendUrl()}/api/health`, {
        headers: await this.backendHeaders(),
        signal: AbortSignal.timeout(2000)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const r = await fetch(`${this.backendUrl()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    if (!r.ok) {
      let message = `Backend returned ${r.status}`;
      try {
        const body = await r.json() as unknown;
        if (isRecord(body)) { message = asString(body.error) ?? message; }
      } catch { /* keep status */ }
      throw new Error(message);
    }
    const body = await r.json() as unknown;
    if (!isRecord(body) || !isRecord(body.admin)) {
      throw new Error("Invalid login response");
    }
    const token = asString(body.token);
    const id = asString(body.admin.id);
    const fullName = asString(body.admin.fullName);
    const emailAddress = asString(body.admin.email);
    if (!token || !id || !fullName || !emailAddress) {
      throw new Error("Invalid login response");
    }
    return { token, admin: { id, fullName, email: emailAddress } };
  }

  /** Stream chat via the backend (PII redaction + shared config); falls back to direct Ollama. */
  async *chat(messages: ChatMsg[], model: string, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    if (await this.health()) {
      const r = await fetch(`${this.backendUrl()}/api/chat`, {
        method: "POST", signal,
        headers: await this.backendHeaders(true),
        body: JSON.stringify({ model, messages })
      });
      if (!r.ok) {
        yield { type: "error", message: `Backend returned ${r.status}` };
        return;
      }
      for await (const ev of readSse(r)) {
        if (ev.event === "error") { yield { type: "error", message: String(ev.data.message ?? "failed") }; return; }
        const token = asString(ev.data.token);
        if (token) { yield { type: "token", text: token }; }
        if (ev.event === "done") {
          const usage = isRecord(ev.data.usage) ? ev.data.usage : {};
          const out = typeof usage.out === "number" ? usage.out : 0;
          yield { type: "done", usage: { out } };
          return;
        }
      }
      return;
    }

    // Fallback: direct Ollama /api/chat NDJSON (chat-only, no MCP/policy/redaction)
    const r = await fetch(`${this.ollamaUrl()}/api/chat`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true })
    });
    if (!r.body) { return; }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) { break; }
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) { continue; }
        try {
          const j = JSON.parse(line);
          if (j.message?.content) { yield { type: "token", text: j.message.content }; }
          if (j.done) { yield { type: "done", usage: { out: j.eval_count ?? 0 } }; }
        } catch { /* skip */ }
      }
    }
  }

  async fim(prefix: string, suffix: string, model: string, signal: AbortSignal): Promise<string> {
    try {
      const r = await fetch(`${this.ollamaUrl()}/api/generate`, {
        method: "POST", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model, raw: true, stream: false,
          prompt: `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`,
          options: {
            num_predict: 128, temperature: 0.2,
            stop: ["<|fim_pad|>", "<|endoftext|>", "\n\n\n"]
          }
        })
      });
      const data = await r.json() as { response?: string };
      return data.response ?? "";
    } catch {
      return "";
    }
  }

  async listModels(): Promise<string[]> {
    const names = new Set<string>();

    // Default cloud models
    const defaults = [
      'openai:gpt-4o',
      'openai:gpt-4o-mini',
      'openai:gpt-4-turbo',
      'openai:o1',
      'openai:o1-mini',
      'anthropic:claude-3-5-sonnet-20241022',
      'anthropic:claude-3-5-haiku-20241022',
      'anthropic:claude-3-opus-20240229',
      'google:gemini-2.0-flash',
      'google:gemini-1.5-pro-latest',
    ];
    defaults.forEach(d => names.add(d));

    try {
      const r = await fetch(`${this.backendUrl()}/api/models`, {
        headers: await this.backendHeaders()
      });
      if (r.ok) {
        const body = await r.json() as unknown;
        if (Array.isArray(body)) {
          body
            .filter(isBackendModel)
            .filter(m => m.tier !== "embedding")
            .forEach(m => names.add(m.name));
        }
      }
    } catch { /* fall back to Ollama */ }

    return [...names].sort((a, b) => a.localeCompare(b));
  }

  /** Starts an agent run; the POST response itself is the SSE event stream. */
  async *runAgent(
    goal: string, model: string, connectors: string[], signal: AbortSignal
  ): AsyncGenerator<AgentEvent> {
    const r = await fetch(`${this.backendUrl()}/api/agent/runs`, {
      method: "POST", signal,
      headers: await this.backendHeaders(true),
      body: JSON.stringify({ goal, model, connectors })
    });
    if (!r.ok) {
      yield { type: "error", message: `Backend returned ${r.status}` };
      return;
    }
    for await (const ev of readSse(r)) {
      yield { type: ev.event, ...ev.data };
    }
  }

  async plan(goal: string, model: string): Promise<string> {
    const r = await fetch(`${this.backendUrl()}/api/plan`, {
      method: "POST",
      headers: await this.backendHeaders(true),
      body: JSON.stringify({ goal, model })
    });
    if (!r.ok) {
      throw new Error(`Backend returned ${r.status}`);
    }
    const data = await r.json() as { steps: { title: string }[] };
    return data.steps.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
  }

  async approve(runId: string, stepId: string, approved: boolean, remember = false): Promise<void> {
    await fetch(`${this.backendUrl()}/api/agent/runs/${runId}/approvals/${stepId}`, {
      method: "POST",
      headers: await this.backendHeaders(true),
      body: JSON.stringify({ decision: approved ? "approve" : "reject", remember })
    });
  }

  async cancel(runId: string): Promise<void> {
    await fetch(`${this.backendUrl()}/api/agent/runs/${runId}/cancel`, {
      method: "POST",
      headers: await this.backendHeaders()
    });
  }
}
