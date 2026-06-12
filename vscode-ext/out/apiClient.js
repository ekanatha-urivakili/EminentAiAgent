"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiClient = void 0;
class ApiClient {
    backendUrl;
    ollamaUrl;
    constructor(backendUrl, ollamaUrl) {
        this.backendUrl = backendUrl;
        this.ollamaUrl = ollamaUrl;
    }
    async health() {
        try {
            const res = await fetch(`${this.backendUrl()}/api/models`);
            return res.ok;
        }
        catch {
            return false;
        }
    }
    async *chat(messages, model, signal) {
        if (await this.health()) {
            const r = await fetch(`${this.backendUrl()}/api/chat`, {
                method: "POST", signal,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages, model, client: "vscode" })
            });
            // A full implementation would parse SSE here
            yield { type: "done", usage: { out: 0 } };
            return;
        }
        // Fallback: direct Ollama /api/chat (chat-only, no MCP/policy)
        const r = await fetch(`${this.ollamaUrl()}/api/chat`, {
            method: "POST", signal,
            body: JSON.stringify({ model, messages, stream: true })
        });
        if (!r.body)
            return;
        // Polyfill for streaming response in node/fetch
        // @ts-ignore
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buf += dec.decode(value, { stream: true });
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line)
                    continue;
                const j = JSON.parse(line);
                if (j.message?.content)
                    yield { type: "token", text: j.message.content };
                if (j.done)
                    yield { type: "done", usage: { out: j.eval_count } };
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
                    prompt: `<|fim_prefix|>\${prefix}<|fim_suffix|>\${suffix}<|fim_middle|>`,
                    options: { num_predict: 128, temperature: 0.2,
                        stop: ["<|fim_pad|>", "<|endoftext|>", "\\n\\n\\n"] }
                })
            });
            const data = await r.json();
            return data.response ?? "";
        }
        catch {
            return "";
        }
    }
    async startAgentRun(args) {
        return { id: "mock-run-id" };
    }
    async *streamRun(runId) {
        // yield mock events
    }
    async approve(runId, stepId, approved) { }
    async cancel(runId) { }
}
exports.ApiClient = ApiClient;
//# sourceMappingURL=apiClient.js.map