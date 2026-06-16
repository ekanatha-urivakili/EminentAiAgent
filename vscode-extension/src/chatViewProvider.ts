import * as vscode from 'vscode';
import * as path from 'path';
import { streamChat, listOllamaModels, validateOllamaUrl } from './llmClient';
import { SessionManager } from './sessionManager';
import { buildSystemPrompt, effortToTemperature, buildMessages } from './ollamaClient';
import type { WebviewMessage, ExtensionMessage, Mode, ThinkingEffort } from './types';
import { getWebviewContent } from './webviewContent';

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'eminentai.chatView';

  private _view?: vscode.WebviewView;
  private _abortController: AbortController | null = null;
  private _pendingMsgId: string | null = null;
  private _pendingContent = '';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'out'),
        vscode.Uri.joinPath(this.extensionUri, 'resources'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };

    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      await this.handleMessage(msg);
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) { this.sendSessions(); }
    });
  }

  // ── Message router ────────────────────────────────────────────────────────

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this.sendConfig();
        this.sendSessions();
        void this.refreshModels();
        break;

      case 'get_models':
        void this.refreshModels();
        break;

      case 'get_sessions':
        this.sendSessions();
        break;

      case 'new_session': {
        const contextFile = await this.getActiveFileContext();
        const session = this.sessionManager.createSession(msg.model, msg.mode, msg.effort, contextFile);
        this.sendSessions();
        this.post({ type: 'session', session });
        break;
      }

      case 'switch_session': {
        const session = this.sessionManager.setActive(msg.sessionId);
        if (session) {
          this.sendSessions();
          this.post({ type: 'session', session });
        }
        break;
      }

      case 'delete_session':
        this.sessionManager.deleteSession(msg.sessionId);
        this.sendSessions();
        break;

      case 'rename_session':
        this.sessionManager.renameSession(msg.sessionId, msg.title);
        this.sendSessions();
        break;

      case 'clear_session':
        this.sessionManager.clearSession(msg.sessionId);
        this.sendSessions();
        {
          const cleared = this.sessionManager.getActive();
          if (cleared) { this.post({ type: 'session', session: cleared }); }
        }
        break;

      case 'send_message':
        await this.handleSendMessage(msg);
        break;

      case 'cancel_stream':
        this.cancelStream();
        break;

      case 'pin_model':
        await this.pinModel(msg.modelId, true);
        break;

      case 'unpin_model':
        await this.pinModel(msg.modelId, false);
        break;

      case 'insert_at_cursor':
        await this.insertAtCursor(msg.code);
        break;

      case 'get_active_file': {
        const ctx = await this.getActiveFileContext();
        if (ctx) { this.post({ type: 'insert_code', code: ctx }); }
        break;
      }

    }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  private async handleSendMessage(msg: Extract<WebviewMessage, { type: 'send_message' }>): Promise<void> {
    if (this._abortController) {
      this.post({ type: 'error', message: 'Already processing a message. Cancel first.' });
      return;
    }

    const { sessionId, content, model, mode, effort, attachedCode } = msg;

    let userContent = content;
    if (attachedCode) {
      userContent = `${content}\n\n\`\`\`\n${attachedCode}\n\`\`\``;
    }

    this.sessionManager.addUserMessage(sessionId, userContent, model, mode, effort);

    const history = this.sessionManager.getHistory(sessionId);
    const cfg = vscode.workspace.getConfiguration('eminentai');
    const maxHistory = cfg.get<number>('maxHistoryMessages', 20);
    const systemPrompt = buildSystemPrompt(mode, effort);
    const temperature = effortToTemperature(effort);
    const messages = buildMessages(
      systemPrompt,
      history.map(m => ({ role: m.role, content: m.content })),
      maxHistory * 2,
    );

    const msgId = `msg-${Date.now()}`;
    this._pendingMsgId = msgId;
    this._pendingContent = '';
    this.post({ type: 'stream_start', msgId });

    this._abortController = new AbortController();

    const ollamaUrl = cfg.get<string>('ollamaUrl', 'http://localhost:11434');

    streamChat(
      model,
      messages,
      temperature,
      { ollamaUrl },
      {
        onDelta: (delta) => {
          this._pendingContent += delta;
          this.post({ type: 'stream_delta', msgId, delta });
        },
        onDone: (tokens, durationMs) => {
          this.sessionManager.addAssistantMessage(sessionId, this._pendingContent, model, tokens, durationMs);
          this.post({ type: 'stream_end', msgId, tokens, durationMs });
          this._abortController = null;
          this._pendingMsgId = null;
          this._pendingContent = '';
          this.sendSessions();
        },
        onError: (err) => {
          const isCancel = err.message === 'Cancelled' || err.message.includes('aborted');
          if (!isCancel) {
            this.post({ type: 'stream_error', msgId, error: err.message });
          } else {
            if (this._pendingContent) {
              this.sessionManager.addAssistantMessage(sessionId, this._pendingContent + '\n\n*(cancelled)*', model, 0, 0);
            }
            this.post({ type: 'stream_end', msgId, tokens: 0, durationMs: 0 });
          }
          this._abortController = null;
          this._pendingMsgId = null;
          this._pendingContent = '';
        },
      },
      this._abortController.signal,
    );
  }

  cancelStream(): void {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  // ── Model management ──────────────────────────────────────────────────────

  async refreshModels(): Promise<void> {
    try {
      const cfg = vscode.workspace.getConfiguration('eminentai');
      const url = validateOllamaUrl(cfg.get<string>('ollamaUrl', 'http://localhost:11434'));
      const models = await listOllamaModels(url);
      this.post({ type: 'models', models });
    } catch {
      this.post({ type: 'error', message: 'Failed to load models — is Ollama running at localhost:11434?' });
    }
  }

  private async pinModel(modelId: string, pin: boolean): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('eminentai');
    const pinned = cfg.get<string[]>('pinnedModels', []);
    const updated = pin
      ? [...new Set([...pinned, modelId])]
      : pinned.filter(p => p !== modelId);
    await cfg.update('pinnedModels', updated, vscode.ConfigurationTarget.Global);
    await this.refreshModels();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private sendSessions(): void {
    this.post({
      type: 'sessions',
      sessions: this.sessionManager.getAll(),
      activeId: this.sessionManager.activeId,
    });
  }

  private async sendConfig(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('eminentai');
    this.post({
      type: 'config',
      ollamaUrl: cfg.get<string>('ollamaUrl', 'http://localhost:11434'),
      contextLines: cfg.get<number>('contextLines', 50),
    });
  }

  private post(msg: ExtensionMessage): void {
    this._view?.webview.postMessage(msg);
  }

  private async insertAtCursor(code: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('EminentAI: No active editor to insert into.');
      return;
    }
    await editor.edit(builder => {
      builder.insert(editor.selection.active, code);
    });
  }

  private async getActiveFileContext(): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return undefined; }
    const cfg = vscode.workspace.getConfiguration('eminentai');
    const lines = cfg.get<number>('contextLines', 50);
    const doc = editor.document;
    const lang = doc.languageId;
    const fname = path.basename(doc.fileName);
    const start = Math.max(0, editor.selection.active.line - Math.floor(lines / 2));
    const end = Math.min(doc.lineCount - 1, start + lines);
    const snippet = doc.getText(new vscode.Range(start, 0, end, doc.lineAt(end).range.end.character));
    return `// File: ${fname}\n\`\`\`${lang}\n${snippet}\n\`\`\``;
  }

  injectText(text: string): void {
    this.post({ type: 'insert_code', code: text });
  }

  onConfigurationChanged(): void {
    void this.sendConfig();
    void this.refreshModels();
  }

  dispose(): void {
    this.cancelStream();
  }

  getLastAssistantContent(): string | undefined {
    const session = this.sessionManager.getActive();
    if (!session) { return undefined; }
    const msgs = [...session.messages].reverse();
    return msgs.find(m => m.role === 'assistant')?.content;
  }
}
