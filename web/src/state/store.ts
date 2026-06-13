import { create } from 'zustand';
import { api } from '../lib/api';
import type {
  AgentRunState, ChatMsg, ConnectorInfo, CreateConnectorRequest,
  ConversationDetail, ConversationSummary, Mode, ModelInfo, Plan, Theme, AppView,
  AdminProfile, ChatAttachment,
  JobSearchCriteria, JobSearchRunResult, SourceHealthInfo, IndeedJobInput,
} from '../lib/types';

interface AppState {
  // ── theme ────────────────────────────────────────────────────────────────
  theme: Theme;
  setTheme: (t: Theme) => void;

  // ── backend status ───────────────────────────────────────────────────────
  backendOk: boolean;
  ollamaOk: boolean;
  refreshHealth: () => Promise<void>;

  // ── models ───────────────────────────────────────────────────────────────
  models: ModelInfo[];
  selectedModel: string;
  setSelectedModel: (m: string) => void;
  loadModels: () => Promise<void>;

  // ── mode ─────────────────────────────────────────────────────────────────
  appView: AppView;
  setAppView: (view: AppView) => void;
  mode: Mode;
  setMode: (m: Mode) => void;

  // ── conversations + branches ──────────────────────────────────────────────
  conversations: ConversationSummary[];
  archivedIds: string[];
  activeConversationId?: string;
  activeBranchId?: string;
  /** Full branch list for the active conversation — used by the branch switcher. */
  branches: ConversationDetail['branches'];
  messages: ChatMsg[];
  isStreaming: boolean;
  loadConversations: () => Promise<void>;
  newConversation: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
  archiveConversation: (id: string) => void;
  unarchiveConversation: (id: string) => void;
  sendMessage: (content: string) => Promise<void>;
  sendMessageWithAttachments: (content: string, attachments: ChatAttachment[]) => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
  stopStreaming: () => void;
  /** Switch to a different branch within the active conversation. */
  switchBranch: (branchId: string) => void;
  /** Create a new branch forked from a specific message, then switch to it. */
  forkConversation: (messageId: string) => Promise<void>;

  // ── plan ─────────────────────────────────────────────────────────────────
  plan?: Plan;
  planLoading: boolean;
  planError?: string;
  createPlan: (goal: string) => Promise<void>;
  updatePlanStep: (ordinal: number, title: string) => void;
  promotePlanToAgent: () => void;

  // ── agent ────────────────────────────────────────────────────────────────
  agent: AgentRunState;
  /** Step budget passed to each agent run (1-50). */
  agentStepBudget: number;
  setAgentStepBudget: (n: number) => void;
  /** Connector names the agent may use. Defaults to built-in ['filesystem','shell']. */
  agentConnectors: string[];
  setAgentConnectors: (cs: string[]) => void;
  startAgent: (goal: string, planJson?: string) => Promise<void>;
  approveStep: (stepId: string, decision: 'approve' | 'reject', remember: boolean) => Promise<void>;
  cancelAgent: () => Promise<void>;
  resetAgent: () => void;

  // ── connectors ───────────────────────────────────────────────────────────
  connectors: ConnectorInfo[];
  loadConnectors: () => Promise<void>;
  addConnector: (data: CreateConnectorRequest) => Promise<void>;
  removeConnector: (id: string) => Promise<void>;

  admin?: AdminProfile;
  authLoading: boolean;
  authError?: string;
  loadAdmin: () => Promise<void>;
  registerAdmin: (fullName: string, email: string, password: string) => Promise<void>;
  loginAdmin: (email: string, password: string) => Promise<void>;
  logoutAdmin: () => void;
  forgotPassword: (email: string) => Promise<{ ok: boolean; message?: string; error?: string }>;
  resetPassword: (token: string, newPassword: string) => Promise<{ ok: boolean; message?: string; error?: string }>;

  // ── voice mode ───────────────────────────────────────────────────────────
  voiceModeEnabled: boolean;
  toggleVoiceMode: () => void;

  // ── job search agent ──────────────────────────────────────────────────────
  jobResults?: JobSearchRunResult;
  jobLoading: boolean;
  jobError?: string;
  jobSettings: JobSearchCriteria;
  jobSources: SourceHealthInfo[];
  cvFiles: string[];
  loadJobResults: () => Promise<void>;
  runJobSearch: () => Promise<void>;
  loadJobSettings: () => Promise<void>;
  saveJobSettings: (settings: JobSearchCriteria) => Promise<void>;
  ingestIndeedJobs: (jobs: IndeedJobInput[], clearFirst?: boolean) => Promise<void>;
  loadJobSources: () => Promise<void>;
  loadCvFiles: () => Promise<void>;
  uploadCv: (file: File) => Promise<void>;
  deleteCv: (filename: string) => Promise<void>;
}

const initialAgent: AgentRunState = {
  status: 'idle',
  timeline: [],
  streamText: '',
  tools: [],
  steps: 0,
  stepBudget: 15,
  tokensUsed: 0,
};

let chatAbort: AbortController | null = null;
let agentAbort: AbortController | null = null;
let itemSeq = 0;
const nextId = () => `t_${++itemSeq}`;

const storedTheme = (localStorage.getItem('localforge.theme') as Theme | null) ?? 'system';
const storedArchivedIds: string[] = (() => {
  try { return JSON.parse(localStorage.getItem('localforge.archivedIds') ?? '[]'); } catch { return []; }
})();
const storedStepBudget = Number(localStorage.getItem('localforge.stepBudget') ?? 15);
const storedConnectors: string[] = (() => {
  try {
    return JSON.parse(localStorage.getItem('localforge.agentConnectors') ?? '["filesystem","shell"]');
  } catch { return ['filesystem', 'shell']; }
})();

export const useStore = create<AppState>((set, get) => ({
  // ── theme ─────────────────────────────────────────────────────────────────
  theme: storedTheme,
  setTheme: (theme) => {
    localStorage.setItem('localforge.theme', theme);
    set({ theme });
  },

  // ── health ────────────────────────────────────────────────────────────────
  backendOk: false,
  ollamaOk: false,
  refreshHealth: async () => {
    try {
      const h = await api.health();
      set({ backendOk: true, ollamaOk: h.ollama });
    } catch {
      set({ backendOk: false, ollamaOk: false });
    }
  },

  // ── models ────────────────────────────────────────────────────────────────
  models: [],
  selectedModel: localStorage.getItem('localforge.model') ?? '',
  setSelectedModel: (m) => {
    localStorage.setItem('localforge.model', m);
    set({ selectedModel: m });
  },
  loadModels: async () => {
    try {
      const models = await api.models();
      const chatModels = models.filter((m) => m.tier !== 'embedding');
      const current = get().selectedModel;
      set({
        models,
        selectedModel: current && models.some((m) => m.name === current)
          ? current
          : (chatModels[0]?.name ?? ''),
      });
    } catch { /* surfaced via health pill */ }
  },

  // ── mode ──────────────────────────────────────────────────────────────────
  appView: 'chat',
  setAppView: (appView) => set({ appView }),
  mode: 'Chat',
  setMode: (mode) => set({ mode, appView: 'chat' }),

  // ── conversations + branches ───────────────────────────────────────────────
  conversations: [],
  archivedIds: storedArchivedIds,
  activeConversationId: undefined,
  activeBranchId: undefined,
  branches: [],
  messages: [],
  isStreaming: false,

  loadConversations: async () => {
    try { set({ conversations: await api.listConversations() }); } catch { /* offline */ }
  },

  newConversation: async () => {
    set({ activeConversationId: undefined, activeBranchId: undefined, branches: [], messages: [], appView: 'chat' });
  },

  selectConversation: async (id) => {
    const detail = await api.getConversation(id);
    const branch = detail.branches[detail.branches.length - 1];
    set({
      activeConversationId: id,
      activeBranchId: branch?.id,
      branches: detail.branches,
      messages: (branch?.messages ?? []).filter((m) => m.role === 'user' || m.role === 'assistant'),
      mode: 'Chat',
      appView: 'chat',
    });
  },

  removeConversation: async (id) => {
    await api.deleteConversation(id);
    const { activeConversationId } = get();
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      archivedIds: s.archivedIds.filter((aid) => aid !== id),
      ...(activeConversationId === id
        ? { activeConversationId: undefined, activeBranchId: undefined, branches: [], messages: [] }
        : {}),
    }));
  },

  archiveConversation: (id) => {
    set((s) => {
      if (s.archivedIds.includes(id)) return s;
      const archivedIds = [...s.archivedIds, id];
      localStorage.setItem('localforge.archivedIds', JSON.stringify(archivedIds));
      return {
        archivedIds,
        ...(s.activeConversationId === id
          ? { activeConversationId: undefined, activeBranchId: undefined, branches: [], messages: [] }
          : {}),
      };
    });
  },

  unarchiveConversation: (id) => {
    set((s) => {
      const archivedIds = s.archivedIds.filter((aid) => aid !== id);
      localStorage.setItem('localforge.archivedIds', JSON.stringify(archivedIds));
      return { archivedIds };
    });
  },

  switchBranch: (branchId) => {
    const { branches } = get();
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) return;
    set({
      activeBranchId: branchId,
      messages: branch.messages.filter((m) => m.role === 'user' || m.role === 'assistant'),
    });
  },

  forkConversation: async (messageId) => {
    const { activeBranchId, activeConversationId } = get();
    if (!activeBranchId || !activeConversationId) return;
    const result = await api.fork(activeBranchId, messageId);
    // Reload the conversation to pick up the new branch, then switch to it.
    const detail = await api.getConversation(activeConversationId);
    const newBranch = detail.branches.find((b) => b.id === result.id);
    set({
      branches: detail.branches,
      activeBranchId: newBranch?.id ?? activeBranchId,
      messages: (newBranch?.messages ?? []).filter((m) => m.role === 'user' || m.role === 'assistant'),
    });
  },

  sendMessage: async (content) => {
    await get().sendMessageWithAttachments(content, []);
  },

  sendMessageWithAttachments: async (content, attachments) => {
    const { selectedModel } = get();
    let { activeBranchId } = get();
    let activeConversationId: string | undefined;

    if (!activeBranchId) {
      const created = await api.createConversation(selectedModel);
      activeBranchId = created.branchId;
      activeConversationId = created.id;
      set({ activeBranchId, activeConversationId, branches: [] });
      void get().loadConversations();
    }

    const userMsg: ChatMsg = { id: `u_${Date.now()}`, role: 'user', content, attachments };
    const assistantMsg: ChatMsg = { id: `a_${Date.now()}`, role: 'assistant', content: '', model: selectedModel, streaming: true };
    set((s) => ({ messages: [...s.messages, userMsg, assistantMsg], isStreaming: true }));

    chatAbort = new AbortController();
    try {
      for await (const ev of api.sendMessage(activeBranchId, content, selectedModel, attachments, chatAbort.signal)) {
        if (ev.event === 'error') throw new Error(String(ev.data.message ?? 'Generation failed'));
        const token = ev.data.token as string | undefined;
        const realId = ev.data.messageId as string | undefined;
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === assistantMsg.id || (realId !== undefined && m.id === realId)
              ? {
                  ...m,
                  id: realId ?? m.id,
                  content: token ? m.content + token : m.content,
                  streaming: ev.event !== 'done',
                  tokensOut: ev.event === 'done' ? (ev.data.usage as { out?: number } | null)?.out : m.tokensOut,
                }
              : m,
          ),
        }));
        if (realId) assistantMsg.id = realId;
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: m.content || `⚠️ ${(err as Error).message}`, streaming: false }
              : m,
          ),
        }));
      }
    } finally {
      set((s) => ({
        isStreaming: false,
        messages: s.messages.map((m) => ({ ...m, streaming: false })),
      }));
      void get().loadConversations(); // pick up auto-title
    }
  },

  regenerate: async (messageId) => {
    const { selectedModel } = get();
    set((s) => ({
      isStreaming: true,
      messages: s.messages.map((m) =>
        m.id === messageId ? { ...m, content: '', streaming: true, model: selectedModel } : m,
      ),
    }));
    chatAbort = new AbortController();
    let currentId = messageId;
    try {
      for await (const ev of api.regenerate(messageId, selectedModel, chatAbort.signal)) {
        if (ev.event === 'error') throw new Error(String(ev.data.message ?? 'Regenerate failed'));
        const token = ev.data.token as string | undefined;
        const realId = ev.data.messageId as string | undefined;
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === currentId
              ? { ...m, id: realId ?? m.id, content: token ? m.content + token : m.content }
              : m,
          ),
        }));
        if (realId) currentId = realId;
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === currentId ? { ...m, content: `⚠️ ${(err as Error).message}` } : m,
          ),
        }));
      }
    } finally {
      set((s) => ({
        isStreaming: false,
        messages: s.messages.map((m) => ({ ...m, streaming: false })),
      }));
    }
  },

  stopStreaming: () => {
    chatAbort?.abort();
    set({ isStreaming: false });
  },

  // ── plan ──────────────────────────────────────────────────────────────────
  plan: undefined,
  planLoading: false,
  planError: undefined,

  createPlan: async (goal) => {
    set({ planLoading: true, planError: undefined });
    try {
      const plan = await api.plan(goal, get().selectedModel);
      set({ plan, planLoading: false });
    } catch (err) {
      set({ planError: (err as Error).message, planLoading: false });
    }
  },

  updatePlanStep: (ordinal, title) => {
    set((s) => s.plan
      ? { plan: { ...s.plan, steps: s.plan.steps.map((st) => st.ordinal === ordinal ? { ...st, title } : st) } }
      : {});
  },

  promotePlanToAgent: () => {
    const { plan } = get();
    if (!plan) return;
    set({ mode: 'Agent' });
    void get().startAgent(plan.goal, JSON.stringify(plan.steps));
  },

  // ── agent ─────────────────────────────────────────────────────────────────
  agent: { ...initialAgent },
  agentStepBudget: Math.min(Math.max(storedStepBudget || 15, 1), 50),
  setAgentStepBudget: (n) => {
    const clamped = Math.min(Math.max(n, 1), 50);
    localStorage.setItem('localforge.stepBudget', String(clamped));
    set({ agentStepBudget: clamped });
  },
  agentConnectors: storedConnectors,
  setAgentConnectors: (cs) => {
    localStorage.setItem('localforge.agentConnectors', JSON.stringify(cs));
    set({ agentConnectors: cs });
  },

  resetAgent: () => set({ agent: { ...initialAgent } }),

  startAgent: async (goal, planJson) => {
    agentAbort?.abort();
    agentAbort = new AbortController();
    const { agentStepBudget, agentConnectors } = get();
    set({ agent: { ...initialAgent, goal, status: 'running', stepBudget: agentStepBudget } });

    const push = (item: Omit<import('../lib/types').AgentTimelineItem, 'id'>) =>
      set((s) => ({ agent: { ...s.agent, timeline: [...s.agent.timeline, { ...item, id: nextId() }] } }));

    try {
      for await (const ev of api.startAgentRun(
        goal, get().selectedModel, agentConnectors, planJson, agentStepBudget, agentAbort.signal,
      )) {
        const d = ev.data;
        switch (ev.event) {
          case 'run_started':
            set((s) => ({
              agent: {
                ...s.agent,
                runId: String(d.runId),
                tools: (d.tools as string[]) ?? [],
                stepBudget: Number(d.stepBudget ?? agentStepBudget),
              },
            }));
            break;
          case 'token':
            set((s) => ({ agent: { ...s.agent, streamText: s.agent.streamText + String(d.text ?? '') } }));
            break;
          case 'thought':
            set((s) => ({ agent: { ...s.agent, streamText: '' } }));
            push({ kind: 'thought', stepId: String(d.stepId), text: String(d.text ?? '') });
            break;
          case 'tool_call':
            set((s) => ({ agent: { ...s.agent, streamText: '', steps: s.agent.steps + 1 } }));
            push({
              kind: 'tool_call',
              stepId: String(d.stepId),
              tool: String(d.tool),
              args: d.args,
              pendingApproval: Boolean(d.requiresApproval),
            });
            if (d.requiresApproval) set((s) => ({ agent: { ...s.agent, status: 'waiting_approval' } }));
            break;
          case 'approval_required':
            set((s) => ({ agent: { ...s.agent, status: 'waiting_approval' } }));
            break;
          case 'tool_approved':
            set((s) => ({
              agent: {
                ...s.agent,
                status: 'running',
                timeline: s.agent.timeline.map((t) =>
                  t.stepId === String(d.stepId) ? { ...t, pendingApproval: false } : t),
              },
            }));
            break;
          case 'tool_rejected':
            set((s) => ({
              agent: {
                ...s.agent,
                status: 'running',
                timeline: s.agent.timeline.map((t) =>
                  t.stepId === String(d.stepId) ? { ...t, pendingApproval: false } : t),
              },
            }));
            push({ kind: 'tool_rejected', stepId: String(d.stepId), tool: String(d.tool), text: 'Rejected by you' });
            break;
          case 'tool_denied':
            set((s) => ({ agent: { ...s.agent, status: 'running' } }));
            push({ kind: 'tool_denied', stepId: String(d.stepId), tool: String(d.tool), text: 'Denied by security policy' });
            break;
          case 'tool_result':
            push({ kind: 'tool_result', stepId: String(d.stepId), tool: String(d.tool), text: String(d.result ?? '') });
            break;
          case 'tool_failed':
            push({ kind: 'tool_failed', stepId: d.stepId ? String(d.stepId) : undefined, tool: String(d.tool), text: String(d.error ?? 'failed') });
            break;
          case 'done':
            set((s) => ({
              agent: {
                ...s.agent,
                status: 'done',
                streamText: '',
                answer: String(d.answer ?? ''),
                tokensUsed: Number(d.tokensUsed ?? 0),
              },
            }));
            break;
          case 'halted':
            set((s) => ({
              agent: { ...s.agent, status: 'halted', streamText: '', reason: String(d.reason ?? '') },
            }));
            break;
          case 'error':
            set((s) => ({
              agent: { ...s.agent, status: 'error', reason: String(d.message ?? 'Unknown error') },
            }));
            break;
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        set((s) => ({ agent: { ...s.agent, status: 'error', reason: (err as Error).message } }));
      }
    } finally {
      set((s) => ({
        agent: s.agent.status === 'running' || s.agent.status === 'waiting_approval'
          ? { ...s.agent, status: 'halted', reason: s.agent.reason ?? 'Stream closed' }
          : s.agent,
      }));
    }
  },

  approveStep: async (stepId, decision, remember) => {
    const { agent } = get();
    if (!agent.runId) return;
    await api.approve(agent.runId, stepId, decision, remember);
  },

  cancelAgent: async () => {
    const { agent } = get();
    if (agent.runId) {
      try { await api.cancelRun(agent.runId); } catch { /* run may have finished */ }
    }
    agentAbort?.abort();
  },

  // ── connectors ────────────────────────────────────────────────────────────
  connectors: [],

  loadConnectors: async () => {
    try {
      set({ connectors: await api.listConnectors() });
    } catch { /* backend may be offline */ }
  },

  addConnector: async (data) => {
    const result = await api.createConnector(data);
    // Reload the full list so rules are included.
    const connectors = await api.listConnectors();
    set({ connectors });
    return result as unknown as void;
  },

  removeConnector: async (id) => {
    await api.deleteConnector(id);
    set((s) => ({ connectors: s.connectors.filter((c) => c.id !== id) }));
  },

  admin: undefined,
  authLoading: false,
  authError: undefined,

  loadAdmin: async () => {
    if (!localStorage.getItem('localforge.adminToken')) return;
    set({ authLoading: true, authError: undefined });
    try {
      set({ admin: await api.me(), authLoading: false });
    } catch {
      localStorage.removeItem('localforge.adminToken');
      set({ admin: undefined, authLoading: false });
    }
  },

  registerAdmin: async (fullName, email, password) => {
    set({ authLoading: true, authError: undefined });
    try {
      const result = await api.register(fullName, email, password);
      localStorage.setItem('localforge.adminToken', result.token);
      set({ admin: result.admin, authLoading: false });
    } catch (err) {
      set({ authLoading: false, authError: (err as Error).message });
    }
  },

  loginAdmin: async (email, password) => {
    set({ authLoading: true, authError: undefined });
    try {
      const result = await api.login(email, password);
      localStorage.setItem('localforge.adminToken', result.token);
      set({ admin: result.admin, authLoading: false });
    } catch (err) {
      set({ authLoading: false, authError: (err as Error).message || 'Login failed' });
    }
  },

  logoutAdmin: () => {
    localStorage.removeItem('localforge.adminToken');
    set({ admin: undefined });
  },

  forgotPassword: async (email) => {
    try {
      const res = await api.forgotPassword(email);
      return { ok: true, message: res.message };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },

  resetPassword: async (token, newPassword) => {
    try {
      const res = await api.resetPassword(token, newPassword);
      return { ok: true, message: res.message };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },

  voiceModeEnabled: false,
  toggleVoiceMode: () => set((s) => ({ voiceModeEnabled: !s.voiceModeEnabled })),

  // ── job search agent ───────────────────────────────────────────────────────
  jobResults: undefined,
  jobLoading: false,
  jobError: undefined,
  jobSettings: {
    keywords: [],
    postcode: '',
    radiusMiles: 30,
    postedWithinDays: 7,
    employmentTypes: ['Permanent', 'Contract'],
    minimumPermanentSalaryGbp: 0,
    minimumContractDayRateGbp: 0,
    minimumContractMonths: 0,
  },
  jobSources: [],
  cvFiles: [],

  loadJobResults: async () => {
    try {
      const results = await api.getJobResults();
      if (results) set({ jobResults: results });
    } catch { /* offline */ }
  },

  runJobSearch: async () => {
    set({ jobLoading: true, jobError: undefined });
    try {
      const results = await api.searchJobs();
      set({ jobResults: results, jobLoading: false });
    } catch (err) {
      set({ jobLoading: false, jobError: (err as Error).message });
    }
  },

  loadJobSettings: async () => {
    try {
      const settings = await api.getJobSettings();
      set({ jobSettings: settings });
    } catch { /* use defaults */ }
  },

  saveJobSettings: async (settings) => {
    await api.saveJobSettings(settings);
    set({ jobSettings: settings });
  },

  ingestIndeedJobs: async (jobs, clearFirst = true) => {
    set({ jobLoading: true, jobError: undefined });
    try {
      await api.ingestIndeedJobs(jobs, clearFirst);
      const results = await api.getJobResults();
      if (results) set({ jobResults: results, jobLoading: false });
      else set({ jobLoading: false });
    } catch (err) {
      set({ jobLoading: false, jobError: (err as Error).message });
    }
  },

  loadJobSources: async () => {
    try {
      const sources = await api.getJobSources();
      set({ jobSources: sources });
    } catch { /* offline */ }
  },

  loadCvFiles: async () => {
    try {
      const files = await api.listCvFiles();
      set({ cvFiles: files });
    } catch { /* offline */ }
  },

  uploadCv: async (file) => {
    await api.uploadCv(file);
    const files = await api.listCvFiles();
    set({ cvFiles: files });
  },

  deleteCv: async (filename) => {
    await api.deleteCv(filename);
    set((s) => ({ cvFiles: s.cvFiles.filter((f) => f !== filename) }));
  },
}));
