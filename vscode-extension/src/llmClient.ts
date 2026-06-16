/**
 * Multi-provider LLM client.
 * Supports Ollama (local), OpenAI, and Anthropic via streaming HTTP.
 * Route is determined by modelId prefix: "openai:<model>", "anthropic:<model>", else Ollama.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import type { ChatMessage, LLMModel, Provider } from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 120_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MB

// ── Static model catalogues ───────────────────────────────────────────────────

export const OPENAI_MODELS: Omit<LLMModel, 'enabled' | 'pinned'>[] = [
  { id: 'openai:gpt-4o',           name: 'GPT-4o',            provider: 'openai', contextLength: 128000 },
  { id: 'openai:gpt-4o-mini',      name: 'GPT-4o mini',       provider: 'openai', contextLength: 128000 },
  { id: 'openai:gpt-4-turbo',      name: 'GPT-4 Turbo',       provider: 'openai', contextLength: 128000 },
  { id: 'openai:gpt-3.5-turbo',    name: 'GPT-3.5 Turbo',     provider: 'openai', contextLength: 16385  },
  { id: 'openai:o1',               name: 'o1',                 provider: 'openai', contextLength: 200000 },
  { id: 'openai:o1-mini',          name: 'o1-mini',            provider: 'openai', contextLength: 128000 },
  { id: 'openai:o3-mini',          name: 'o3-mini',            provider: 'openai', contextLength: 200000 },
  { id: 'openai:o4-mini',          name: 'o4-mini',            provider: 'openai', contextLength: 200000 },
];

export const ANTHROPIC_MODELS: Omit<LLMModel, 'enabled' | 'pinned'>[] = [
  { id: 'anthropic:claude-opus-4-8',        name: 'Claude Opus 4.8',        provider: 'anthropic', contextLength: 200000 },
  { id: 'anthropic:claude-sonnet-4-6',      name: 'Claude Sonnet 4.6',      provider: 'anthropic', contextLength: 200000 },
  { id: 'anthropic:claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5',    provider: 'anthropic', contextLength: 200000 },
  { id: 'anthropic:claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet',  provider: 'anthropic', contextLength: 200000 },
  { id: 'anthropic:claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku',    provider: 'anthropic', contextLength: 200000 },
  { id: 'anthropic:claude-3-opus-20240229', name: 'Claude 3 Opus',          provider: 'anthropic', contextLength: 200000 },
];

// ── SSRF guard for Ollama ─────────────────────────────────────────────────────

export function validateOllamaUrl(raw: string): string {
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

// ── Provider detection ────────────────────────────────────────────────────────

export function providerFromModelId(modelId: string): Provider {
  if (modelId.startsWith('openai:'))     { return 'openai'; }
  if (modelId.startsWith('anthropic:'))  { return 'anthropic'; }
  if (modelId.startsWith('google:'))     { return 'google'; }
  return 'ollama';
}

export function rawModelName(modelId: string): string {
  const idx = modelId.indexOf(':');
  return idx >= 0 ? modelId.slice(idx + 1) : modelId;
}

// ── Low-level HTTP helpers ────────────────────────────────────────────────────

function httpRequest(options: https.RequestOptions & { body: string; isHttps: boolean },
  onResponse: (res: http.IncomingMessage) => void,
  onError: (e: Error) => void,
  signal?: AbortSignal
): void {
  const transport = options.isHttps ? https : http;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { body, isHttps, ...reqOpts } = options;

  const bodyBuf = Buffer.from(body, 'utf8');
  if (bodyBuf.length > MAX_BODY_BYTES) {
    onError(new Error('Request body exceeds 8 MB limit'));
    return;
  }

  const req = transport.request({ ...reqOpts, timeout: TIMEOUT_MS }, onResponse);
  req.on('error', onError);
  req.on('timeout', () => req.destroy(new Error('Request timed out')));
  if (signal) {
    signal.addEventListener('abort', () => req.destroy(new Error('Cancelled')), { once: true });
  }
  req.write(bodyBuf);
  req.end();
}

// ── SSE parser ────────────────────────────────────────────────────────────────

function parseSseLine(line: string): string | null {
  // "data: {...}" → "{...}"
  if (line.startsWith('data:')) {
    return line.slice(5).trim();
  }
  return null;
}

// ── Streaming callbacks ───────────────────────────────────────────────────────

export interface StreamCallbacks {
  onDelta: (token: string) => void;
  onDone: (totalTokens: number, durationMs: number) => void;
  onError: (err: Error) => void;
}

// ── Ollama streaming ──────────────────────────────────────────────────────────

export function streamOllama(
  baseUrl: string,
  modelName: string,
  messages: ChatMessage[],
  temperature: number,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): void {
  const url = new URL(`${baseUrl}/api/chat`);
  const body = JSON.stringify({ model: modelName, messages, stream: true, options: { temperature } });
  const startMs = Date.now();

  httpRequest({
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? '443' : '80'),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
    isHttps: url.protocol === 'https:',
  }, (res) => {
    if (res.statusCode && res.statusCode >= 400) {
      let err = '';
      res.on('data', (c: Buffer) => { err += c.toString(); });
      res.on('end', () => callbacks.onError(new Error(`Ollama ${res.statusCode}: ${err.slice(0, 300)}`)));
      return;
    }
    let buf = '';
    let totalTokens = 0;

    res.on('data', (chunk: Buffer) => {
      if (signal?.aborted) { return; }
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t) { continue; }
        try {
          const p = JSON.parse(t);
          if (p.message?.content) { callbacks.onDelta(p.message.content); }
          if (p.done && p.eval_count) { totalTokens = p.eval_count; }
        } catch { /* skip */ }
      }
    });
    res.on('end', () => {
      if (buf.trim()) {
        try {
          const p = JSON.parse(buf.trim());
          if (p.message?.content) { callbacks.onDelta(p.message.content); }
          if (p.eval_count) { totalTokens = p.eval_count; }
        } catch { /* skip */ }
      }
      callbacks.onDone(totalTokens, Date.now() - startMs);
    });
    res.on('error', callbacks.onError);
  }, callbacks.onError, signal);
}

// ── OpenAI streaming ──────────────────────────────────────────────────────────

export function streamOpenAI(
  apiKey: string,
  modelName: string,
  messages: ChatMessage[],
  temperature: number,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): void {
  const body = JSON.stringify({ model: modelName, messages, stream: true, temperature });
  const startMs = Date.now();
  let totalTokens = 0;
  let buf = '';

  httpRequest({
    hostname: 'api.openai.com',
    port: '443',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(body),
    },
    body,
    isHttps: true,
  }, (res) => {
    if (res.statusCode && res.statusCode >= 400) {
      let err = '';
      res.on('data', (c: Buffer) => { err += c.toString(); });
      res.on('end', () => callbacks.onError(new Error(`OpenAI ${res.statusCode}: ${err.slice(0, 300)}`)));
      return;
    }
    res.on('data', (chunk: Buffer) => {
      if (signal?.aborted) { return; }
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const data = parseSseLine(line);
        if (!data || data === '[DONE]') { continue; }
        try {
          const p = JSON.parse(data);
          const delta = p.choices?.[0]?.delta?.content;
          if (delta) { callbacks.onDelta(delta); }
          if (p.usage?.completion_tokens) { totalTokens = p.usage.completion_tokens; }
        } catch { /* skip */ }
      }
    });
    res.on('end', () => callbacks.onDone(totalTokens, Date.now() - startMs));
    res.on('error', callbacks.onError);
  }, callbacks.onError, signal);
}

// ── Anthropic streaming ───────────────────────────────────────────────────────

export function streamAnthropic(
  apiKey: string,
  modelName: string,
  messages: ChatMessage[],
  temperature: number,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): void {
  // Anthropic uses separate system message
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  const body = JSON.stringify({
    model: modelName,
    messages: chatMessages,
    max_tokens: 8192,
    stream: true,
    temperature,
    ...(systemMsg ? { system: systemMsg.content } : {}),
  });

  const startMs = Date.now();
  let totalTokens = 0;
  let buf = '';

  httpRequest({
    hostname: 'api.anthropic.com',
    port: '443',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
    isHttps: true,
  }, (res) => {
    if (res.statusCode && res.statusCode >= 400) {
      let err = '';
      res.on('data', (c: Buffer) => { err += c.toString(); });
      res.on('end', () => callbacks.onError(new Error(`Anthropic ${res.statusCode}: ${err.slice(0, 300)}`)));
      return;
    }
    res.on('data', (chunk: Buffer) => {
      if (signal?.aborted) { return; }
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const data = parseSseLine(line);
        if (!data) { continue; }
        try {
          const p = JSON.parse(data);
          if (p.type === 'content_block_delta' && p.delta?.text) {
            callbacks.onDelta(p.delta.text);
          }
          if (p.type === 'message_delta' && p.usage?.output_tokens) {
            totalTokens = p.usage.output_tokens;
          }
        } catch { /* skip */ }
      }
    });
    res.on('end', () => callbacks.onDone(totalTokens, Date.now() - startMs));
    res.on('error', callbacks.onError);
  }, callbacks.onError, signal);
}

// ── Ollama model listing ──────────────────────────────────────────────────────

export async function listOllamaModels(baseUrl: string): Promise<LLMModel[]> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/tags`);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const req = transport.get({
      hostname: url.hostname,
      port: url.port || (isHttps ? '443' : '80'),
      path: url.pathname,
      timeout: 10_000,
    }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => { data += c.toString(); });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const models: LLMModel[] = (parsed.models ?? []).map((m: { name: string; size?: number; details?: { parameter_size?: string } }) => ({
            id: `ollama:${m.name}`,
            name: m.name,
            provider: 'ollama' as Provider,
            enabled: true,
            pinned: false,
            size: m.size,
            parameterSize: m.details?.parameter_size,
          }));
          resolve(models);
        } catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Timeout fetching Ollama models')));
  });
}

// ── Main router ───────────────────────────────────────────────────────────────

export interface LLMClientConfig {
  ollamaUrl: string;
  openAiKey?: string;
  anthropicKey?: string;
  googleKey?: string;
}

export function streamChat(
  modelId: string,
  messages: ChatMessage[],
  temperature: number,
  config: LLMClientConfig,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): void {
  const provider = providerFromModelId(modelId);
  const model = rawModelName(modelId);

  switch (provider) {
    case 'openai': {
      if (!config.openAiKey) {
        callbacks.onError(new Error('OpenAI API key not configured. Open Settings → Models → API Keys.'));
        return;
      }
      streamOpenAI(config.openAiKey, model, messages, temperature, callbacks, signal);
      break;
    }
    case 'anthropic': {
      if (!config.anthropicKey) {
        callbacks.onError(new Error('Anthropic API key not configured. Open Settings → Models → API Keys.'));
        return;
      }
      streamAnthropic(config.anthropicKey, model, messages, temperature, callbacks, signal);
      break;
    }
    case 'google': {
      if (!config.googleKey) {
        callbacks.onError(new Error('Google API key not configured. Open Settings → Models → API Keys.'));
        return;
      }
      streamGoogle(config.googleKey, model, messages, temperature, callbacks, signal);
      break;
    }
    default: {
      // Ollama — model may have "ollama:" prefix stripped already
      try {
        const validatedUrl = validateOllamaUrl(config.ollamaUrl);
        streamOllama(validatedUrl, model, messages, temperature, callbacks, signal);
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }
}

// ── Google Gemini streaming ───────────────────────────────────────────────────

export function streamGoogle(
  apiKey: string,
  modelName: string,
  messages: ChatMessage[],
  _temperature: number,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): void {
  // Gemini uses a different message structure
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  const contents = chatMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = JSON.stringify({
    contents,
    ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg.content }] } } : {}),
    generationConfig: { maxOutputTokens: 8192 },
  });

  const path = `/v1beta/models/${encodeURIComponent(modelName)}:streamGenerateContent?key=${encodeURIComponent(apiKey)}&alt=sse`;
  const startMs = Date.now();
  let totalTokens = 0;
  let buf = '';

  httpRequest({
    hostname: 'generativelanguage.googleapis.com',
    port: '443',
    path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
    isHttps: true,
  }, (res) => {
    if (res.statusCode && res.statusCode >= 400) {
      let err = '';
      res.on('data', (c: Buffer) => { err += c.toString(); });
      res.on('end', () => callbacks.onError(new Error(`Google ${res.statusCode}: ${err.slice(0, 300)}`)));
      return;
    }
    res.on('data', (chunk: Buffer) => {
      if (signal?.aborted) { return; }
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const data = parseSseLine(line);
        if (!data) { continue; }
        try {
          const p = JSON.parse(data);
          const text = p.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) { callbacks.onDelta(text); }
          const outTok = p.usageMetadata?.candidatesTokenCount;
          if (outTok) { totalTokens = outTok; }
        } catch { /* skip */ }
      }
    });
    res.on('end', () => callbacks.onDone(totalTokens, Date.now() - startMs));
    res.on('error', callbacks.onError);
  }, callbacks.onError, signal);
}

export const GOOGLE_MODELS: Omit<LLMModel, 'enabled' | 'pinned'>[] = [
  { id: 'google:gemini-2.5-pro',        name: 'Gemini 2.5 Pro',      provider: 'google', contextLength: 1000000 },
  { id: 'google:gemini-2.5-flash',      name: 'Gemini 2.5 Flash',    provider: 'google', contextLength: 1000000 },
  { id: 'google:gemini-2.0-flash',      name: 'Gemini 2.0 Flash',    provider: 'google', contextLength: 1000000 },
  { id: 'google:gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro',      provider: 'google', contextLength: 2000000 },
];
