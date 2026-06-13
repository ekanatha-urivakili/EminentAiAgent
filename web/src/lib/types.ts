export type Mode = 'Chat' | 'Plan' | 'Agent';
export type AppView = 'chat' | 'ollama' | 'library' | 'mailpit' | 'connectors' | 'jobs';
export type Theme = 'light' | 'dark' | 'system';

export interface ModelInfo {
  name: string;
  sizeBytes: number;
  family?: string;
  parameterSize?: string;
  tier: 'fast' | 'balanced' | 'reasoning' | 'vision' | 'embedding';
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  modelDefault: string;
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  attachments?: ChatAttachment[];
  sources?: ChatSource[];
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  createdAt?: string;
  streaming?: boolean;
}

export interface ChatSource {
  title?: string;
  url: string;
}

export interface ChatAttachment {
  id?: string;
  name: string;
  contentType: string;
  dataUrl: string;
  dataBase64?: string;
}

export interface ConversationDetail {
  id: string;
  title: string;
  modelDefault: string;
  systemPrompt: string;
  branches: { id: string; parentBranchId?: string; messages: ChatMsg[] }[];
}

export interface PlanStep {
  ordinal: number;
  title: string;
  detail: string;
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
}

export type AgentEventPayload = Record<string, unknown>;

export interface AgentTimelineItem {
  id: string;
  kind: 'thought' | 'tool_call' | 'tool_result' | 'tool_failed' | 'tool_denied' | 'tool_rejected' | 'answer' | 'info';
  stepId?: string;
  tool?: string;
  args?: unknown;
  text?: string;
  pendingApproval?: boolean;
}

export interface AgentRunState {
  runId?: string;
  goal?: string;
  status: 'idle' | 'running' | 'waiting_approval' | 'done' | 'halted' | 'error';
  timeline: AgentTimelineItem[];
  streamText: string;
  answer?: string;
  reason?: string;
  tools: string[];
  steps: number;
  stepBudget: number;
  tokensUsed: number;
}

// ── Connectors ──────────────────────────────────────────────────────────────
export type ConnectorTransport = 'stdio' | 'sse' | 'http';
export type PolicyProfile = 'readOnly' | 'readWrite' | 'blocked';
export type PolicyAction = 'allow' | 'ask' | 'deny';

export interface PolicyRule {
  id: string;
  toolPattern: string;
  action: PolicyAction;
}

export interface ConnectorInfo {
  id: string;
  name: string;
  transport: ConnectorTransport;
  commandOrUrl: string;
  enabled: boolean;
  policyProfile: PolicyProfile;
  rules: PolicyRule[];
}

export interface CreateConnectorRequest {
  name: string;
  transport: ConnectorTransport;
  commandOrUrl: string;
  policyProfile: PolicyProfile;
}

export interface AdminProfile {
  id: string;
  fullName: string;
  email: string;
}

// ── Ollama registry search ───────────────────────────────────────────────────
export interface OllamaRegistryModel {
  name: string;
  description?: string;
  pulls?: number;
  tags?: Array<{ name: string; size?: number }>;
  updated_at?: string;
}

// ── Job Search Agent ─────────────────────────────────────────────────────────

export interface JobSearchCriteria {
  timeZone: string;
  runAt: string;
  keywords: string[];
  desiredDesignations: string[];
  skills: string[];
  excludedKeywords: string[];
  postcode: string;
  radiusMiles: number;
  postedWithinDays: number;
  employmentTypes: string[];
  workModes: string[];
  minimumPermanentSalaryGbp: number;
  minimumContractDayRateGbp: number;
  minimumContractMonths: number;
  reedApiKey?: string;
  slackWebhookUrl?: string;
  gmailCredentialsJson?: string;
  gmailUserEmail?: string;
  gmailSearchQuery?: string;
  configuredSecretKeys: string[];
}

export interface NormalizedJob {
  id: string;
  source: string;
  sourceJobId: string;
  title: string;
  company: string;
  location: string;
  url?: string;
  employmentType?: string;
  workMode?: string;
  salaryMin?: number;
  salaryMax?: number;
  dayRateMin?: number;
  dayRateMax?: number;
  contractMonths?: number;
  postedDate?: string;
  description?: string;
}

export interface JobMatchResult {
  posting: NormalizedJob;
  score: number;
  recommended: boolean;
  reasons: string[];
  risks: string[];
}

export interface SourceStatus {
  source: string;
  status: string;
  jobsFetched: number;
  mode: string;
  error?: string;
}

export interface SourceHealthInfo {
  source: string;
  mode: string;
  ready: boolean;
  requiredSecret?: string;
  lastError?: string;
  bufferedJobs: number;
}

export interface JobSearchRunResult {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  status: string;
  sourceStatuses: SourceStatus[];
  matches: JobMatchResult[];
  rejectedSummary: Record<string, number>;
  reportMarkdown?: string;
}

export interface IndeedJobInput {
  jobId: string;
  jobkey?: string;
  jk?: string;
  title: string;
  jobTitle?: string;
  company: string;
  companyName?: string;
  location: string;
  formattedLocation?: string;
  url?: string;
  jobUrl?: string;
  employmentType?: string;
  workMode?: string;
  salaryMin?: number;
  salaryMax?: number;
  dayRateMin?: number;
  dayRateMax?: number;
  contractMonths?: number;
  description?: string;
  jobDescription?: string;
  snippet?: string;
}

// ── Agent run history ────────────────────────────────────────────────────────
export interface AgentStepDetail {
  id: string;
  ordinal: number;
  kind: string;
  status: string;
  toolName?: string;
  toolArgsJson?: string;
  resultJson?: string;
  thought?: string;
  createdAt: string;
}

export interface AgentRunDetail {
  id: string;
  goal: string;
  model: string;
  status: string;
  stepBudget: number;
  startedAt: string;
  finishedAt?: string;
  finalAnswer?: string;
  steps: AgentStepDetail[];
}
