"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiClient = void 0;
/** Parses a fetch Response body as Server-Sent Events. */
async function* readSse(r) {
    if (!r.body) {
        return;
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let eventType = "message";
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trimEnd();
            buf = buf.slice(nl + 1);
            if (line.startsWith("event: ")) {
                eventType = line.slice(7).trim();
            }
            else if (line.startsWith("data: ")) {
                try {
                    const parsed = JSON.parse(line.slice(6));
                    const data = isRecord(parsed) ? parsed : {};
                    yield { event: eventType, data };
                }
                catch { /* skip malformed frame */ }
                eventType = "message";
            }
        }
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function asString(value) {
    return typeof value === "string" ? value : undefined;
}
function isBackendModel(value) {
    return isRecord(value) && typeof value.name === "string" && typeof value.tier === "string";
}
function isOllamaTag(value) {
    return isRecord(value) && typeof value.name === "string";
}
class ApiClient {
    backendUrl;
    ollamaUrl;
    authToken;
    constructor(backendUrl, ollamaUrl, authToken) {
        this.backendUrl = backendUrl;
        this.ollamaUrl = ollamaUrl;
        this.authToken = authToken;
    }
    async backendHeaders(contentType = false) {
        const token = await this.authToken();
        return {
            ...(contentType ? { "Content-Type": "application/json" } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        };
    }
    async health() {
        try {
            const res = await fetch(`${this.backendUrl()}/api/health`, {
                headers: await this.backendHeaders(),
                signal: AbortSignal.timeout(2000)
            });
            return res.ok;
        }
        catch {
            return false;
        }
    }
    async login(email, password) {
        const r = await fetch(`${this.backendUrl()}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });
        if (!r.ok) {
            let message = `Backend returned ${r.status}`;
            try {
                const body = await r.json();
                if (isRecord(body)) {
                    message = asString(body.error) ?? message;
                }
            }
            catch { /* keep status */ }
            throw new Error(message);
        }
        const body = await r.json();
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
    async *chat(messages, model, signal) {
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
                if (ev.event === "error") {
                    yield { type: "error", message: String(ev.data.message ?? "failed") };
                    return;
                }
                const token = asString(ev.data.token);
                if (token) {
                    yield { type: "token", text: token };
                }
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
        if (!r.body) {
            return;
        }
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buf += dec.decode(value, { stream: true });
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line) {
                    continue;
                }
                try {
                    const j = JSON.parse(line);
                    if (j.message?.content) {
                        yield { type: "token", text: j.message.content };
                    }
                    if (j.done) {
                        yield { type: "done", usage: { out: j.eval_count ?? 0 } };
                    }
                }
                catch { /* skip */ }
            }
        }
    }
    async fim(prefix, suffix, model, signal) {
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
            const data = await r.json();
            return data.response ?? "";
        }
        catch {
            return "";
        }
    }
    async listModels() {
        const names = new Set();
        try {
            const r = await fetch(`${this.backendUrl()}/api/models`, {
                headers: await this.backendHeaders()
            });
            if (r.ok) {
                const body = await r.json();
                if (Array.isArray(body)) {
                    body
                        .filter(isBackendModel)
                        .filter(m => m.tier !== "embedding")
                        .forEach(m => names.add(m.name));
                }
            }
        }
        catch { /* fall back to Ollama */ }
        try {
            const r = await fetch(`${this.ollamaUrl()}/api/tags`, {
                signal: AbortSignal.timeout(2000)
            });
            if (r.ok) {
                const body = await r.json();
                const models = isRecord(body) && Array.isArray(body.models) ? body.models : [];
                models.filter(isOllamaTag).forEach(m => names.add(m.name));
            }
        }
        catch { /* no local Ollama models available */ }
        return [...names].sort((a, b) => a.localeCompare(b));
    }
    /** Starts an agent run; the POST response itself is the SSE event stream. */
    async *runAgent(goal, model, connectors, signal) {
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
    async plan(goal, model) {
        const r = await fetch(`${this.backendUrl()}/api/plan`, {
            method: "POST",
            headers: await this.backendHeaders(true),
            body: JSON.stringify({ goal, model })
        });
        if (!r.ok) {
            throw new Error(`Backend returned ${r.status}`);
        }
        const data = await r.json();
        return data.steps.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
    }
    async approve(runId, stepId, approved, remember = false) {
        await fetch(`${this.backendUrl()}/api/agent/runs/${runId}/approvals/${stepId}`, {
            method: "POST",
            headers: await this.backendHeaders(true),
            body: JSON.stringify({ decision: approved ? "approve" : "reject", remember })
        });
    }
    async cancel(runId) {
        await fetch(`${this.backendUrl()}/api/agent/runs/${runId}/cancel`, {
            method: "POST",
            headers: await this.backendHeaders()
        });
    }
}
exports.ApiClient = ApiClient;
//# sourceMappingURL=apiClient.js.map