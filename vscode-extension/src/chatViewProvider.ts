import * as vscode from 'vscode';
import * as path from 'path';
import { streamChat, listOllamaModels, validateOllamaUrl } from './llmClient';
import { SessionManager } from './sessionManager';
import { ApprovalModeStore } from './approvalModeStore';
import { buildSystemPrompt, effortToTemperature, buildMessages } from './ollamaClient';
import type { WebviewMessage, ExtensionMessage } from './types';
import { getWebviewContent } from './webviewContent';
import { runWorkspaceAgent } from './workspaceAgent';

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'eminentai.chatView';

  private _view?: vscode.WebviewView;
  private _abortController: AbortController | null = null;
  private _pendingMsgId: string | null = null;
  private _pendingContent = '';
  private readonly fileChanges = new Map<string, { beforeContent: string | undefined }>();
  private readonly diffProviderDisposable: vscode.Disposable;
  private readonly approvalResolvers = new Map<string, (decision: 'once' | 'session' | 'reject') => void>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager,
    private readonly approvalModeStore: ApprovalModeStore,
  ) {
    this.diffProviderDisposable = vscode.workspace.registerTextDocumentContentProvider('eminentai-before', {
      provideTextDocumentContent: (uri) =>
        this.fileChanges.get(uri.path.replace(/^\//, ''))?.beforeContent ?? '',
    });
  }

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
        this.sendApprovalMode();
        void this.refreshModels();
        break;

      case 'get_models':
        void this.refreshModels();
        break;

      case 'get_sessions':
        this.sendSessions();
        break;

      case 'get_approval_mode':
        this.sendApprovalMode();
        break;

      case 'set_approval_mode':
        await this.approvalModeStore.set(msg.mode);
        break;

      case 'select_images':
        await this.selectImages();
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

      case 'open_file':
        await this.openWorkspaceFile(msg.path);
        break;

      case 'review_file_change':
        await this.reviewFileChange(msg.path);
        break;

      case 'undo_file_change':
        await this.undoFileChange(msg.path);
        break;

      case 'get_active_file': {
        const ctx = await this.getActiveFileContext();
        if (ctx) { this.post({ type: 'insert_code', code: ctx }); }
        break;
      }

      case 'open_external': {
        try {
          const uri = vscode.Uri.parse(msg.url);
          if (uri.scheme === 'http' || uri.scheme === 'https') {
            await vscode.env.openExternal(uri);
          }
        } catch (error) {
          console.warn('Ignoring malformed open_external url', msg.url, error);
        }
        break;
      }

      case 'approval_response': {
        const resolve = this.approvalResolvers.get(msg.requestId);
        if (resolve) {
          this.approvalResolvers.delete(msg.requestId);
          resolve(msg.decision);
        }
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

    const { sessionId, content, model, mode, effort, attachedCode, attachedImages } = msg;

    let userContent = content;
    if (attachedCode) {
      userContent = `${content}\n\n\`\`\`\n${attachedCode}\n\`\`\``;
    }

    this.sessionManager.addUserMessage(sessionId, userContent, model, mode, effort);

    const history = this.sessionManager.getHistory(sessionId);
    const cfg = vscode.workspace.getConfiguration('eminentai');
    const maxHistory = cfg.get<number>('maxHistoryMessages', 20);
    let systemPrompt = buildSystemPrompt(mode, effort);
    const workspaceInstructions = await this.getWorkspaceInstructions();
    if (workspaceInstructions) {
      systemPrompt += `\n\nWorkspace instructions from EminentAI.md:\n${workspaceInstructions}`;
    }
    const temperature = effortToTemperature(effort);
    const messages = buildMessages(
      systemPrompt,
      history.map(m => ({ role: m.role, content: m.content })),
      maxHistory * 2,
    );
    if (attachedImages?.length) {
      const lastUser = [...messages].reverse().find((message) => message.role === 'user');
      if (lastUser) lastUser.images = attachedImages.map((image) => image.dataBase64);
    }

    const msgId = `msg-${Date.now()}`;
    this._pendingMsgId = msgId;
    this._pendingContent = '';
    this.post({ type: 'stream_start', msgId });

    this._abortController = new AbortController();

    const ollamaUrl = cfg.get<string>('ollamaUrl', 'http://localhost:11434');

    const callbacks = {
      onStatus: (status: string) => {
        this.post({ type: 'agent_status' as const, msgId, status });
      },
      onFileChange: (change: {
        path: string;
        beforeContent: string | undefined;
        additions: number;
        deletions: number;
      }) => {
        if (!this.fileChanges.has(change.path)) {
          this.fileChanges.set(change.path, { beforeContent: change.beforeContent });
        }
        this.post({
          type: 'file_change' as const,
          path: change.path,
          additions: change.additions,
          deletions: change.deletions,
        });
      },
      onDelta: (delta: string) => {
        this._pendingContent += delta;
        this.post({ type: 'stream_delta' as const, msgId, delta });
      },
      onDone: (tokens: number, durationMs: number) => {
        this.sessionManager.addAssistantMessage(sessionId, this._pendingContent, model, tokens, durationMs);
        this.post({ type: 'stream_end' as const, msgId, tokens, durationMs });
        this._abortController = null;
        this._pendingMsgId = null;
        this._pendingContent = '';
        this.sendSessions();
      },
      onError: (err: Error) => {
        const isCancel = err.message === 'Cancelled' || err.message.includes('aborted');
        if (!isCancel) {
          this.post({ type: 'stream_error' as const, msgId, error: err.message });
        } else {
          if (this._pendingContent) {
            this.sessionManager.addAssistantMessage(sessionId, this._pendingContent + '\n\n*(cancelled)*', model, 0, 0);
          }
          this.post({ type: 'stream_end' as const, msgId, tokens: 0, durationMs: 0 });
        }
        this._abortController = null;
        this._pendingMsgId = null;
        this._pendingContent = '';
      },
    };

    if (mode === 'agent' && !model.startsWith('openai:') && !model.startsWith('anthropic:') && !model.startsWith('google:')) {
      void runWorkspaceAgent(
        model,
        messages,
        ollamaUrl,
        callbacks,
        this.approvalModeStore.get(),
        (tool, summary) => this.requestApproval(tool, summary),
        this._abortController.signal,
      );
      return;
    }

    streamChat(
      model,
      messages,
      temperature,
      { ollamaUrl },
      callbacks,
      this._abortController.signal,
    );
  }

  cancelStream(): void {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    for (const resolve of this.approvalResolvers.values()) resolve('reject');
    this.approvalResolvers.clear();
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

  private sendApprovalMode(): void {
    this.post({ type: 'approval_mode', mode: this.approvalModeStore.get() });
  }

  private async sendConfig(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('eminentai');
    this.post({
      type: 'config',
      ollamaUrl: cfg.get<string>('ollamaUrl', 'http://localhost:11434'),
      contextLines: cfg.get<number>('contextLines', 50),
      defaultModel: cfg.get<string>('defaultModel', 'ollama:gemma4:e4b'),
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

  private async openWorkspaceFile(relativePath: string): Promise<void> {
    const uri = this.resolveWorkspacePath(relativePath);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: true });
  }

  private async undoFileChange(relativePath: string): Promise<void> {
    const change = this.fileChanges.get(relativePath);
    if (!change) {
      this.post({ type: 'error', message: `No undo snapshot is available for ${relativePath}.` });
      return;
    }
    const uri = this.resolveWorkspacePath(relativePath);
    if (change.beforeContent === undefined) {
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
    } else {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(change.beforeContent));
    }
    this.fileChanges.delete(relativePath);
    this.post({ type: 'agent_status', msgId: this._pendingMsgId ?? '', status: `Reverted ${relativePath}` });
  }

  private async reviewFileChange(relativePath: string): Promise<void> {
    const change = this.fileChanges.get(relativePath);
    if (!change) {
      await this.openWorkspaceFile(relativePath);
      return;
    }
    const before = vscode.Uri.from({ scheme: 'eminentai-before', path: `/${relativePath}` });
    const current = this.resolveWorkspacePath(relativePath);
    await vscode.commands.executeCommand(
      'vscode.diff',
      before,
      current,
      `${relativePath} — Before ↔ Current`,
      { preview: true },
    );
  }

  private resolveWorkspacePath(relativePath: string): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error('Open a workspace folder first.');
    if (path.isAbsolute(relativePath)) throw new Error('Use a workspace-relative path.');
    const target = path.resolve(folder.uri.fsPath, relativePath);
    const prefix = folder.uri.fsPath.endsWith(path.sep) ? folder.uri.fsPath : `${folder.uri.fsPath}${path.sep}`;
    if (target !== folder.uri.fsPath && !target.startsWith(prefix)) throw new Error('Path escapes the workspace.');
    return vscode.Uri.file(target);
  }

  private async selectImages(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      openLabel: 'Attach images',
      filters: {
        Images: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
      },
    });
    if (!uris?.length) return;

    const selected = uris.slice(0, 10);
    const images = [];
    for (const uri of selected) {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > 5 * 1024 * 1024) {
        this.post({ type: 'error', message: `${path.basename(uri.fsPath)} exceeds 5 MB.` });
        continue;
      }
      const extension = path.extname(uri.fsPath).toLowerCase();
      const contentType = extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : `image/${extension.slice(1)}`;
      images.push({
        name: path.basename(uri.fsPath),
        contentType,
        dataBase64: Buffer.from(bytes).toString('base64'),
      });
    }
    if (uris.length > selected.length) {
      this.post({ type: 'error', message: 'A maximum of 10 images can be attached at once.' });
    }
    if (images.length) this.post({ type: 'images_selected', images });
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

  private async getWorkspaceInstructions(): Promise<string | undefined> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return undefined;
    const uri = vscode.Uri.joinPath(folder.uri, 'EminentAI.md');
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return new TextDecoder().decode(bytes).slice(0, 32_000);
    } catch {
      return undefined;
    }
  }

  private requestApproval(
    tool: string,
    summary: string,
  ): Promise<'once' | 'session' | 'reject'> {
    const requestId = `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.post({ type: 'approval_request', requestId, tool, summary });
    return new Promise((resolve) => this.approvalResolvers.set(requestId, resolve));
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
    this.diffProviderDisposable.dispose();
    for (const resolve of this.approvalResolvers.values()) resolve('reject');
    this.approvalResolvers.clear();
  }

  getLastAssistantContent(): string | undefined {
    const session = this.sessionManager.getActive();
    if (!session) { return undefined; }
    const msgs = [...session.messages].reverse();
    return msgs.find(m => m.role === 'assistant')?.content;
  }
}
