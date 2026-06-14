import * as vscode from 'vscode';
import type { Session, SessionMessage, Mode, ThinkingEffort } from './types';

const STORAGE_KEY = 'eminentai.sessions';
const MAX_SESSIONS = 50;
const MAX_MESSAGES_PER_SESSION = 200;

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function truncateTitle(text: string, maxLen = 40): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen - 1) + '…' : clean;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private activeSessionId: string | null = null;

  constructor(private readonly memento: vscode.Memento) {
    this.load();
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private load(): void {
    try {
      const raw = this.memento.get<Session[]>(STORAGE_KEY, []);
      for (const s of raw) {
        if (s?.id && s?.messages) {
          this.sessions.set(s.id, s);
        }
      }
      // Restore last active session
      const ids = [...this.sessions.keys()];
      if (ids.length > 0) {
        this.activeSessionId = ids[ids.length - 1];
      }
    } catch {
      // Corrupt state — start fresh
      this.sessions.clear();
    }
  }

  private async persist(): Promise<void> {
    try { await this._persistInner(); } catch (e) { console.error('[EminentAI] Failed to persist sessions:', e); }
  }

  private async _persistInner(): Promise<void> {
    const list = [...this.sessions.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);
    await this.memento.update(STORAGE_KEY, list);
  }

  // ── Session CRUD ─────────────────────────────────────────────────────────

  createSession(model: string, mode: Mode, effort: ThinkingEffort, contextFile?: string): Session {
    const id = generateId();
    const now = Date.now();
    const session: Session = {
      id,
      title: 'New session',
      createdAt: now,
      updatedAt: now,
      messages: [],
      model,
      mode,
      effort,
      contextFile,
    };
    this.sessions.set(id, session);
    this.activeSessionId = id;
    void this.persist();
    return session;
  }

  deleteSession(id: string): void {
    this.sessions.delete(id);
    if (this.activeSessionId === id) {
      const remaining = [...this.sessions.keys()];
      this.activeSessionId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
    void this.persist();
  }

  renameSession(id: string, title: string): void {
    const s = this.sessions.get(id);
    if (s) {
      s.title = truncateTitle(title, 60);
      s.updatedAt = Date.now();
      void this.persist();
    }
  }

  clearSession(id: string): void {
    const s = this.sessions.get(id);
    if (s) {
      s.messages = [];
      s.updatedAt = Date.now();
      void this.persist();
    }
  }

  setActive(id: string): Session | undefined {
    if (this.sessions.has(id)) {
      this.activeSessionId = id;
      return this.sessions.get(id);
    }
    return undefined;
  }

  getActive(): Session | null {
    return this.activeSessionId ? (this.sessions.get(this.activeSessionId) ?? null) : null;
  }

  getAll(): Session[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get activeId(): string | null {
    return this.activeSessionId;
  }

  // ── Messages ─────────────────────────────────────────────────────────────

  addUserMessage(sessionId: string, content: string, model: string, mode: Mode, effort: ThinkingEffort): SessionMessage {
    const session = this.sessions.get(sessionId);
    if (!session) { throw new Error(`Session ${sessionId} not found`); }

    const msg: SessionMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
      model,
      mode,
      effort,
    };
    session.messages.push(msg);

    // Auto-title from first user message
    if (session.messages.filter(m => m.role === 'user').length === 1) {
      session.title = truncateTitle(content);
    }

    // Trim old messages if too many
    if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
      session.messages = session.messages.slice(-MAX_MESSAGES_PER_SESSION);
    }

    session.updatedAt = Date.now();
    void this.persist();
    return msg;
  }

  addAssistantMessage(sessionId: string, content: string, model: string, tokens: number, durationMs: number): SessionMessage {
    const session = this.sessions.get(sessionId);
    if (!session) { throw new Error(`Session ${sessionId} not found`); }

    const msg: SessionMessage = {
      id: generateId(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
      model,
      tokens,
      durationMs,
    };
    session.messages.push(msg);
    session.updatedAt = Date.now();
    void this.persist();
    return msg;
  }

  getHistory(sessionId: string): SessionMessage[] {
    return this.sessions.get(sessionId)?.messages ?? [];
  }
}
