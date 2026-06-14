export type Mode = 'agent' | 'ask' | 'plan';
export type ThinkingEffort = 'low' | 'medium' | 'high';

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

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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

export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  model?: string;
  mode?: Mode;
  effort?: ThinkingEffort;
  /** token count from ollama */
  tokens?: number;
  /** duration ms */
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
  /** snippet of active file when session was created */
  contextFile?: string;
}

// Messages sent from extension → webview
export type ExtensionMessage =
  | { type: 'models'; models: OllamaModel[]; pinned: string[] }
  | { type: 'sessions'; sessions: Session[]; activeId: string | null }
  | { type: 'session'; session: Session }
  | { type: 'stream_start'; msgId: string }
  | { type: 'stream_delta'; msgId: string; delta: string }
  | { type: 'stream_end'; msgId: string; tokens: number; durationMs: number }
  | { type: 'stream_error'; msgId: string; error: string }
  | { type: 'config'; ollamaUrl: string; contextLines: number }
  | { type: 'error'; message: string }
  | { type: 'insert_code'; code: string };

// Messages sent from webview → extension
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'get_models' }
  | { type: 'get_sessions' }
  | { type: 'new_session'; model: string; mode: Mode; effort: ThinkingEffort }
  | { type: 'switch_session'; sessionId: string }
  | { type: 'delete_session'; sessionId: string }
  | { type: 'rename_session'; sessionId: string; title: string }
  | { type: 'send_message'; sessionId: string; content: string; model: string; mode: Mode; effort: ThinkingEffort; attachedCode?: string }
  | { type: 'cancel_stream' }
  | { type: 'pin_model'; modelName: string }
  | { type: 'unpin_model'; modelName: string }
  | { type: 'insert_at_cursor'; code: string }
  | { type: 'open_file'; path: string }
  | { type: 'get_active_file' }
  | { type: 'clear_session'; sessionId: string };
