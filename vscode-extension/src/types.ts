import type { ApprovalMode } from './approvalPolicy';
export type { ApprovalMode } from './approvalPolicy';

export type Mode = 'agent' | 'ask' | 'plan';
export type ThinkingEffort = 'low' | 'medium' | 'high';
export type Provider = 'ollama' | 'openai' | 'anthropic' | 'google';

// ── Model types ──────────────────────────────────────────────────────────────

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

/** Unified model representation across all providers. */
export interface LLMModel {
  /** Stable unique ID: "ollama:llama3.2", "openai:gpt-4o", "anthropic:claude-opus-4-8" */
  id: string;
  /** Human-readable display name */
  name: string;
  provider: Provider;
  /** Whether shown in model picker */
  enabled: boolean;
  /** Pinned at top of model picker */
  pinned: boolean;
  contextLength?: number;
  parameterSize?: string;
  /** Bytes (Ollama only) */
  size?: number;
}

// ── Chat types ───────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

export interface ImageAttachment {
  name: string;
  contentType: string;
  dataBase64: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  options?: {
    temperature?: number;
    num_ctx?: number;
  };
}

export interface OllamaChatResponseChunk {
  model: string;
  created_at: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

// ── Session types ────────────────────────────────────────────────────────────

export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  model?: string;
  mode?: Mode;
  effort?: ThinkingEffort;
  tokens?: number;
  durationMs?: number;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: SessionMessage[];
  model: string;
  mode: Mode;
  effort: ThinkingEffort;
  contextFile?: string;
}

// ── Settings types ───────────────────────────────────────────────────────────

export interface ProviderConfig {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  azureEndpoint?: string;
  azureDeployment?: string;
  azureApiKey?: string;
}

// ── Extension → Webview messages ─────────────────────────────────────────────

export type ExtensionMessage =
  | { type: 'models'; models: LLMModel[] }
  | { type: 'sessions'; sessions: Session[]; activeId: string | null }
  | { type: 'session'; session: Session }
  | { type: 'images_selected'; images: ImageAttachment[] }
  | { type: 'stream_start'; msgId: string }
  | { type: 'agent_status'; msgId: string; status: string }
  | { type: 'file_change'; path: string; additions: number; deletions: number }
  | { type: 'stream_delta'; msgId: string; delta: string }
  | { type: 'stream_end'; msgId: string; tokens: number; durationMs: number }
  | { type: 'stream_error'; msgId: string; error: string }
  | { type: 'approval_request'; requestId: string; tool: string; summary: string }
  | { type: 'approval_mode'; mode: ApprovalMode }
  | { type: 'config'; ollamaUrl: string; contextLines: number; defaultModel: string }
  | { type: 'error'; message: string }
  | { type: 'insert_code'; code: string };

// ── Webview → Extension messages ─────────────────────────────────────────────

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'select_images' }
  | { type: 'get_models' }
  | { type: 'get_sessions' }
  | { type: 'new_session'; model: string; mode: Mode; effort: ThinkingEffort }
  | { type: 'switch_session'; sessionId: string }
  | { type: 'delete_session'; sessionId: string }
  | { type: 'rename_session'; sessionId: string; title: string }
  | {
      type: 'send_message';
      sessionId: string;
      content: string;
      model: string;
      mode: Mode;
      effort: ThinkingEffort;
      attachedCode?: string;
      attachedImages?: ImageAttachment[];
    }
  | { type: 'cancel_stream' }
  | { type: 'pin_model'; modelId: string }
  | { type: 'unpin_model'; modelId: string }
  | { type: 'insert_at_cursor'; code: string }
  | { type: 'open_file'; path: string }
  | { type: 'review_file_change'; path: string }
  | { type: 'undo_file_change'; path: string }
  | { type: 'open_external'; url: string }
  | { type: 'approval_response'; requestId: string; decision: 'once' | 'session' | 'reject' }
  | { type: 'get_approval_mode' }
  | { type: 'set_approval_mode'; mode: ApprovalMode }
  | { type: 'get_active_file' }
  | { type: 'clear_session'; sessionId: string };

// ── Settings panel messages ───────────────────────────────────────────────────

export type SettingsExtensionMessage =
  | { type: 'settings_loaded'; settings: SettingsData }
  | { type: 'models_loaded'; models: LLMModel[] }
  | { type: 'save_ok'; key: string }
  | { type: 'error'; message: string };

export type SettingsWebviewMessage =
  | { type: 'ready' }
  | { type: 'get_settings' }
  | { type: 'get_models' }
  | { type: 'set_api_key'; provider: string; value: string }
  | { type: 'set_config'; key: string; value: unknown }
  | { type: 'toggle_model'; modelId: string; enabled: boolean }
  | { type: 'refresh_ollama_models' }
  | { type: 'close_panel' }
  | { type: 'open_external'; url: string }
  | { type: 'get_stats' };

export interface SettingsData {
  ollamaUrl: string;
  defaultModel: string;
  defaultMode: Mode;
  defaultThinkingEffort: ThinkingEffort;
  streamResponses: boolean;
  contextLines: number;
  maxHistoryMessages: number;
  enabledModels: string[];
  pinnedModels: string[];
  /** true = key is set (never expose actual key to webview) */
  hasOpenAiKey: boolean;
  hasAnthropicKey: boolean;
  hasGoogleKey: boolean;
  hasAzureKey: boolean;
  hasAwsKey: boolean;
  azureEnabled: boolean;
  azureEndpoint: string;
  azureDeployment: string;
  // Agent settings
  cmdEnterSubmit: boolean;
  queueMessages: 'after' | 'queue';
  agentAutocomplete: boolean;
  showTips: boolean;
  autoApproveModeTransitions: boolean;
  webSearchTool: boolean;
  autoAcceptWebSearch: boolean;
  // AWS Bedrock
  awsBedrockEnabled: boolean;
  awsBedrockRegion: string;
  awsBedrockModel: string;
  // Rules
  customRules: string;
  // Network
  proxyEnabled: boolean;
  proxyUrl: string;
  // Beta
  betaFeatures: boolean;
  // Stats (Plan & Usage page)
  sessionCount: number;
  messageCount: number;
}
