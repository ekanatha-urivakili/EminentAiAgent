import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import type { OllamaModel, OllamaChatRequest, OllamaChatResponseChunk, ChatMessage } from './types';

const DEFAULT_TIMEOUT_MS = 120_000;

/** Only allow connections to localhost / loopback / private LAN addresses. */
function validateOllamaUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw.replace(/\/$/, '')); }
  catch { throw new Error('Invalid Ollama URL: ' + raw); }

  const host = url.hostname.toLowerCase();
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
    /^fd[0-9a-f]{2}:/i.test(host);

  if (!isLocal) {
    throw new Error('EminentAI only connects to local Ollama instances. Host: ' + host);
  }
  return url.href.replace(/\/$/, '');
}

export class OllamaClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = validateOllamaUrl(baseUrl);
  }

  updateUrl(url: string): void {
    try { this.baseUrl = validateOllamaUrl(url); } catch { /* keep old URL if new one invalid */ }
  }

  /** List all locally installed models. */
  async listModels(): Promise<OllamaModel[]> {
    const res = await this.getJson<{ models: OllamaModel[] }>('/api/tags');
    return res.models ?? [];
  }

  /** Ping Ollama to check connectivity. */
  async ping(): Promise<boolean> {
    try {
      await this.getJson('/api/tags');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stream a chat completion. Calls onDelta for each token and resolves when done.
   * Returns the AbortController so callers can cancel.
   */
  streamChat(
    request: OllamaChatRequest,
    onDelta: (token: string) => void,
    onDone: (totalTokens: number, durationMs: number) => void,
    onError: (err: Error) => void,
    signal?: AbortSignal
  ): void {
    const url = new URL(`${this.baseUrl}/api/chat`);
    const body = JSON.stringify({ ...request, stream: true });
    // Sanity-check payload size: 8 MB upper bound (Ollama default)
    const bodyBytes = Buffer.byteLength(body, 'utf8');
    if (bodyBytes > 8 * 1024 * 1024) {
      onError(new Error('Request body exceeds 8 MB limit — trim conversation history'));
      return;
    }
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const startMs = Date.now();

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: DEFAULT_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = '';
          res.on('data', (c: Buffer) => { errBody += c.toString(); });
          res.on('end', () => onError(new Error(`Ollama ${res.statusCode}: ${errBody.slice(0, 200)}`)));
          return;
        }

        let buf = '';
        let totalTokens = 0;

        res.on('data', (chunk: Buffer) => {
          if (signal?.aborted) { req.destroy(); return; }
          buf += chunk.toString('utf8');
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) { continue; }
            try {
              const parsed = JSON.parse(trimmed) as OllamaChatResponseChunk;
              if (parsed.message?.content) {
                onDelta(parsed.message.content);
              }
              if (parsed.done) {
                totalTokens = parsed.eval_count ?? 0;
              }
            } catch {
              // Partial JSON or non-JSON line — skip
            }
          }
        });

        res.on('end', () => {
          // Flush any remaining buffered data (no trailing newline case)
          if (buf.trim()) {
            try {
              const parsed = JSON.parse(buf.trim()) as OllamaChatResponseChunk;
              if (parsed.message?.content) { onDelta(parsed.message.content); }
              if (parsed.eval_count)       { totalTokens = parsed.eval_count; }
            } catch { /* ignore unparseable final chunk */ }
          }
          onDone(totalTokens, Date.now() - startMs);
        });

        res.on('error', onError);
      }
    );

    req.on('error', onError);
    req.on('timeout', () => {
      req.destroy(new Error('Ollama request timed out'));
    });

    if (signal) {
      signal.addEventListener('abort', () => req.destroy(new Error('Cancelled')), { once: true });
    }

    req.write(body);
    req.end();
  }

  private getJson<T>(path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}${path}`);
      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const req = transport.get(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          timeout: 10_000,  // connection timeout
        },
        (res) => {
          let data = '';
          res.on('data', (c: Buffer) => { data += c.toString(); });
          res.on('end', () => {
            try { resolve(JSON.parse(data) as T); }
            catch (e) { reject(e); }
          });
          res.on('error', reject);
        }
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Timeout')));
    });
  }
}

/** Build the system prompt for a given mode + effort. */
export function buildSystemPrompt(mode: 'agent' | 'ask' | 'plan', effort: 'low' | 'medium' | 'high'): string {
  const effortNote = effort === 'high'
    ? ' Think step-by-step, reason carefully, and consider edge cases.'
    : effort === 'low'
    ? ' Be concise and direct.'
    : '';

  switch (mode) {
    case 'agent':
      return `You are EminentAI, an expert software engineering agent running locally via Ollama.${effortNote}
When writing code:
- Provide complete, working implementations — never truncate with comments like "// rest of code here".
- Include only the changed parts when editing existing code, clearly marked with filename and line range.
- Use code blocks with the correct language identifier.
When asked to perform tasks, break them into clear steps and execute them systematically.`;

    case 'ask':
      return `You are EminentAI, a knowledgeable programming assistant running locally.${effortNote}
Answer questions clearly and accurately. When relevant, include concise code examples in properly fenced code blocks.`;

    case 'plan':
      return `You are EminentAI, a software architecture and planning assistant running locally.${effortNote}
When given a task or goal, produce a numbered, actionable implementation plan.
For each step: describe what to do, which files to change, and why.
End with a summary of risks or open questions.`;
  }
}

/** Temperature mapping for thinking effort. */
export function effortToTemperature(effort: 'low' | 'medium' | 'high'): number {
  switch (effort) {
    case 'low':    return 0.3;
    case 'medium': return 0.7;
    case 'high':   return 1.0;
  }
}

/** Build the chat messages array from session history + system prompt. */
export function buildMessages(
  systemPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  maxMessages: number
): ChatMessage[] {
  const trimmed = history.slice(-maxMessages);
  return [
    { role: 'system', content: systemPrompt },
    ...trimmed.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];
}
