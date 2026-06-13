const BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:5210';

export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('eminentai.adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.error ?? body.detail ?? detail;
    } catch { /* keep statusText */ }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** SSE over fetch (EventSource cannot POST). Yields parsed events until the stream closes. */
export async function* streamSse(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try { detail = (await res.json()).error ?? detail; } catch { /* ignore */ }
    throw new Error(detail || 'Stream failed to open');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = 'message';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trimEnd();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        try {
          yield { event: eventType, data: JSON.parse(line.slice(6)) };
        } catch { /* skip malformed frame */ }
        eventType = 'message';
      }
    }
  }
}

export const api = {
  // ── Health & models ──────────────────────────────────────────────────────
  health: () => request<{ status: string; ollama: boolean }>('/api/health'),
  models: () => request<import('./types').ModelInfo[]>('/api/models'),
  startOllama: () =>
    request<{ running: boolean; message: string }>('/api/ollama/start', { method: 'POST' }),
  stopOllama: () =>
    request<{ stopped: boolean; message: string }>('/api/ollama/stop', { method: 'POST' }),
  searchModels: (q: string) =>
    request<import('./types').OllamaRegistryModel[]>(`/api/ollama/search?q=${encodeURIComponent(q)}`),
  pullModel: (name: string, signal: AbortSignal) =>
    streamSse('/api/ollama/pull', { name }, signal),

  // ── Conversations ────────────────────────────────────────────────────────
  listConversations: () => request<import('./types').ConversationSummary[]>('/api/conversations'),
  createConversation: (model: string, title?: string, systemPrompt?: string) =>
    request<{ id: string; title: string; modelDefault: string; branchId: string }>(
      '/api/conversations',
      { method: 'POST', body: JSON.stringify({ title: title ?? 'New chat', model, systemPrompt }) },
    ),
  getConversation: (id: string) =>
    request<import('./types').ConversationDetail>(`/api/conversations/${id}`),
  deleteConversation: (id: string) =>
    request<void>(`/api/conversations/${id}`, { method: 'DELETE' }),

  // ── Chat (SSE) ───────────────────────────────────────────────────────────
  sendMessage: (
    branchId: string,
    content: string,
    modelOverride: string | undefined,
    attachments: import('./types').ChatAttachment[],
    signal: AbortSignal,
  ) =>
    streamSse(`/api/branches/${branchId}/messages`, {
      content,
      modelOverride,
      attachments: attachments.map((a) => ({
        name: a.name,
        contentType: a.contentType,
        dataBase64: a.dataBase64 ?? a.dataUrl,
      })),
    }, signal),
  regenerate: (messageId: string, model: string | undefined, signal: AbortSignal) =>
    streamSse(`/api/messages/${messageId}/regenerate`, { model }, signal),

  /** Fork a branch from a specific message, creating a new branch rooted at that point. */
  fork: (branchId: string, messageId: string) =>
    request<{ id: string; conversationId: string; parentBranchId: string }>(
      `/api/branches/${branchId}/fork`,
      { method: 'POST', body: JSON.stringify({ messageId }) },
    ),

  // ── Plan ─────────────────────────────────────────────────────────────────
  plan: (goal: string, model: string) =>
    request<import('./types').Plan>('/api/plan', { method: 'POST', body: JSON.stringify({ goal, model }) }),

  // ── Agent ────────────────────────────────────────────────────────────────
  startAgentRun: (
    goal: string,
    model: string,
    connectors: string[],
    planJson: string | undefined,
    stepBudget: number,
    signal: AbortSignal,
  ) => streamSse('/api/agent/runs', { goal, model, connectors, planJson, stepBudget }, signal),

  approve: (runId: string, stepId: string, decision: 'approve' | 'reject', remember: boolean) =>
    request<{ resolved: boolean }>(`/api/agent/runs/${runId}/approvals/${stepId}`, {
      method: 'POST',
      body: JSON.stringify({ decision, remember }),
    }),
  cancelRun: (runId: string) =>
    request<{ cancelled: boolean }>(`/api/agent/runs/${runId}/cancel`, { method: 'POST' }),

  /** Fetch a persisted agent run with all its steps. */
  getAgentRun: (runId: string) =>
    request<import('./types').AgentRunDetail>(`/api/agent/runs/${runId}`),

  // ── Connectors ───────────────────────────────────────────────────────────
  listConnectors: () =>
    request<import('./types').ConnectorInfo[]>('/api/connectors'),
  createConnector: (data: import('./types').CreateConnectorRequest) =>
    request<{ id: string; name: string }>('/api/connectors', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteConnector: (id: string) =>
    request<void>(`/api/connectors/${id}`, { method: 'DELETE' }),

  me: () => request<import('./types').AdminProfile>('/api/auth/me'),
  register: (fullName: string, email: string, password: string) =>
    request<{ token: string; admin: import('./types').AdminProfile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ fullName, email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ token: string; admin: import('./types').AdminProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  forgotPassword: (email: string) =>
    request<{ message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, newPassword: string) =>
    request<{ message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),

  // ── Job Search Agent ──────────────────────────────────────────────────────
  getJobResults: () =>
    request<import('./types').JobSearchRunResult | null>('/api/jobs/results').catch(() => null),
  searchJobs: () =>
    request<import('./types').JobSearchRunResult>('/api/jobs/search'),
  getJobSources: () =>
    request<import('./types').SourceHealthInfo[]>('/api/jobs/sources/health'),
  getJobSettings: () =>
    request<import('./types').JobSearchCriteria>('/api/jobs/settings'),
  saveJobSettings: (criteria: import('./types').JobSearchCriteria) =>
    request<{ saved: boolean }>('/api/jobs/settings', {
      method: 'POST',
      body: JSON.stringify(criteria),
    }),
  ingestIndeedJobs: (jobs: import('./types').IndeedJobInput[], clearFirst = true) =>
    request<{ ingested: number; buffered: number; runId: string; matched: number }>(
      '/api/jobs/ingest_indeed',
      { method: 'POST', body: JSON.stringify({ clearFirst, jobs }) },
    ),
  listCvFiles: () =>
    request<string[]>('/api/cvs'),
  uploadCv: async (file: File): Promise<{ name: string }> => {
    const form = new FormData();
    form.append('file', file);
    const token = localStorage.getItem('eminentai.adminToken');
    const res = await fetch(`${BASE}/api/cvs/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try { const b = await res.json(); detail = b.error ?? detail; } catch { /* ignore */ }
      throw new Error(detail);
    }
    return res.json() as Promise<{ name: string }>;
  },
  deleteCv: (filename: string) =>
    request<void>(`/api/cvs/${encodeURIComponent(filename)}`, { method: 'DELETE' }),

  transcribeAudio: async (blob: Blob): Promise<string> => {
    const form = new FormData();
    form.append('file', blob, 'audio.webm');
    form.append('response_format', 'json');
    const res = await fetch('http://localhost:8082/inference', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`whisper:${res.status}`);
    const data = await res.json() as { text: string };
    return (data.text ?? '').trim();
  },
};
