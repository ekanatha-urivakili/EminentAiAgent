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
                    yield { event: eventType, data: JSON.parse(line.slice(6)) };
                }
                catch { /* skip malformed frame */ }
                eventType = "message";
            }
        }
    }
}
class ApiClient {
    backendUrl;
    ollamaUrl;
    constructor(backendUrl, ollamaUrl) {
        this.backendUrl = backendUrl;
        this.ollamaUrl = ollamaUrl;
    }
    async health() {
        try {
            const res = await fetch(`${this.backendUrl()}/api/health`, { signal: AbortSignal.timeout(2000) });
            return res.ok;
        }
        catch {
            return false;
        }
    }
    /** Stream chat via the backend (PII redaction + shared config); falls back to direct Ollama. */
    async *chat(messages, model, signal) {
        if (await this.health()) {
            const r = await fetch(`${this.backendUrl()}/api/chat`, {
                method: "POST", signal,
                headers: { "Content-Type": "application/json" },
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
                if (ev.data.token) {
                    yield { type: "token", text: ev.data.token };
                }
                if (ev.event === "done") {
                    yield { type: "done", usage: { out: ev.data.usage?.out ?? 0 } };
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
        try {
            const r = await fetch(`${this.backendUrl()}/api/models`);
            if (!r.ok) {
                return [];
            }
            const models = await r.json();
            return models.filter(m => m.tier !== "embedding").map(m => m.name);
        }
        catch {
            return [];
        }
    }
    /** Starts an agent run; the POST response itself is the SSE event stream. */
    async *runAgent(goal, model, connectors, signal) {
        const r = await fetch(`${this.backendUrl()}/api/agent/runs`, {
            method: "POST", signal,
            headers: { "Content-Type": "application/json" },
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
    async approve(runId, stepId, approved, remember = false) {
        await fetch(`${this.backendUrl()}/api/agent/runs/${runId}/approvals/${stepId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision: approved ? "approve" : "reject", remember })
        });
    }
    async cancel(runId) {
        await fetch(`${this.backendUrl()}/api/agent/runs/${runId}/cancel`, { method: "POST" });
    }
}
exports.ApiClient = ApiClient;
//# sourceMappingURL=apiClient.js.map