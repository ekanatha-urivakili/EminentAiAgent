import * as vscode from "vscode";
import { ApiClient, ChatMsg, AgentEvent } from "./apiClient";

export type ChatMode = "Chat" | "Plan" | "Agent";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static current?: ChatViewProvider;
  private view?: vscode.WebviewView;
  private history: ChatMsg[] = [];
  private inflight?: AbortController;
  public mode: ChatMode = "Chat";

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly api: ApiClient
  ) {
    ChatViewProvider.current = this;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionContext.extensionUri]
    };
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "ready": {
          const cfg = vscode.workspace.getConfiguration("eminentai");
          const models = await this.api.listModels();
          this.view?.webview.postMessage({
            type: "init",
            models,
            selectedModel: cfg.get<string>("chatModel"),
            mode: this.mode
          });
          break;
        }
        case "setModel": {
          const cfg = vscode.workspace.getConfiguration("eminentai");
          await cfg.update("chatModel", data.model, vscode.ConfigurationTarget.Global);
          break;
        }
        case "setMode": {
          this.mode = data.mode;
          break;
        }
        case "send": {
          const cfg = vscode.workspace.getConfiguration("eminentai");
          const model = cfg.get<string>("chatModel")!;
          
          if (this.mode === "Agent") {
            await this.runAgent(data.text, model);
          } else {
            await this.runChat(data.text, model);
          }
          break;
        }
        case "clear":
          this.history = [];
          break;
        case "copy":
          await vscode.env.clipboard.writeText(data.text);
          break;
      }
    });
  }

  private async runChat(text: string, model: string) {
    this.history.push({ role: "user", content: text });
    this.inflight?.abort();
    this.inflight = new AbortController();
    
    if (this.mode === "Plan") {
      this.view?.webview.postMessage({ type: "token", text: "Generating plan..." });
      try {
        const plan = await this.api.plan(text, model);
        this.view?.webview.postMessage({ type: "clear_last_token" }); // Optional: if I want to replace the "Generating..." text
        this.view?.webview.postMessage({ type: "token", text: plan });
        this.history.push({ role: "assistant", content: plan });
      } catch (e) {
        this.view?.webview.postMessage({ type: "error", message: String(e) });
      }
      return;
    }

    let reply = "";
    try {
      for await (const ev of this.api.chat(this.history, model, this.inflight.signal)) {
        if (ev.type === "token") { reply += ev.text; }
        this.view?.webview.postMessage(ev);
      }
      this.history.push({ role: "assistant", content: reply });
      if (this.history.length > 40) { this.history = this.history.slice(-40); }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        this.view?.webview.postMessage({ type: "error", message: String(e) });
      }
    }
  }

  private async runAgent(goal: string, model: string) {
    this.inflight?.abort();
    this.inflight = new AbortController();
    let runId: string | undefined;

    try {
      // Connectors are hardcoded for now as in the web app's default
      for await (const ev of this.api.runAgent(goal, model, ["filesystem", "shell"], this.inflight.signal)) {
        if (ev.type === "run_started" && ev.runId) { runId = ev.runId; }
        
        if (ev.type === "approval_required") {
          const argsPreview = JSON.stringify(ev.args ?? {}, null, 2);
          const pick = await vscode.window.showWarningMessage(
            `Agent wants to run: ${ev.tool}\n${argsPreview.slice(0, 500)}`,
            { modal: true },
            "Approve", "Reject"
          );
          if (runId && ev.stepId) {
            await this.api.approve(runId, ev.stepId, pick === "Approve");
          }
          continue; // Don't post this to webview as it's handled via VS Code dialog for now
        }

        this.view?.webview.postMessage({ type: "agent_event", event: ev });
        
        if (ev.type === "done" || ev.type === "halted" || ev.type === "error") { break; }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        this.view?.webview.postMessage({ type: "error", message: String(e) });
      }
    }
  }

  public post(message: unknown) {
    this.view?.webview.postMessage(message);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src https: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EminentAi Chat</title>
  <style>
    :root {
      --font-size: 13px;
    }
    body { font-family: var(--vscode-font-family); padding: 0; display: flex; flex-direction: column; height: 100vh; margin: 0; background: var(--vscode-sideBar-background); color: var(--vscode-sideBar-foreground); }
    
    select {
      appearance: none;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
      border-radius: 999px;
      font-size: 11px;
      line-height: 1;
      padding: 6px 22px 6px 10px;
      outline: none;
      max-width: min(45vw, 150px);
      min-height: 28px;
      background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
      background-position: calc(100% - 12px) 11px, calc(100% - 8px) 11px;
      background-size: 4px 4px, 4px 4px;
      background-repeat: no-repeat;
    }

    select:focus {
      border-color: var(--vscode-focusBorder);
    }

    #messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 12px; }
    
    .msg { 
      padding: 10px 12px; 
      border-radius: 8px; 
      white-space: pre-wrap; 
      word-break: break-word; 
      font-size: var(--font-size); 
      line-height: 1.5;
      position: relative;
    }
    
    .user { 
      background: var(--vscode-input-background); 
      border: 1px solid var(--vscode-input-border, transparent); 
      align-self: flex-end;
      max-width: 90%;
    }
    
    .assistant { 
      background: var(--vscode-editor-inactiveSelectionBackground); 
      align-self: flex-start;
      max-width: 90%;
    }

    .agent-event {
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      opacity: 0.8;
      padding: 4px 8px;
      border-left: 2px solid var(--vscode-button-background);
      margin: 4px 0;
    }

    .thought { font-style: italic; opacity: 0.7; }
    .tool-call { color: var(--vscode-symbolIcon-functionForeground); font-weight: bold; }
    .tool-result { color: var(--vscode-symbolIcon-variableForeground); }

    .label { font-size: 10px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .err { color: var(--vscode-errorForeground); }
    
    .composer {
      padding: 12px;
      border-top: 1px solid var(--vscode-divider);
      background: var(--vscode-sideBar-background);
    }

    .composer-shell {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
      border-radius: 18px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      overflow: hidden;
    }

    .composer-shell:focus-within {
      border-color: var(--vscode-focusBorder);
    }

    textarea { 
      width: 100%; 
      min-height: 56px; 
      max-height: 200px;
      box-sizing: border-box; 
      resize: none;
      background: transparent; 
      color: var(--vscode-input-foreground);
      border: 0;
      padding: 12px 14px 6px; 
      font-family: inherit;
      font-size: var(--font-size);
      outline: none;
    }

    .composer-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 6px 8px 8px;
    }

    .composer-left,
    .composer-right {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .composer-left {
      flex: 1;
      overflow: hidden;
    }

    .local-note {
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      line-height: 1.2;
      margin-top: 8px;
      text-align: center;
    }
    
    button.icon-btn { 
      background: var(--vscode-input-background); 
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); 
      color: var(--vscode-foreground);
      cursor: pointer; 
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
    }
    
    button.icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); }

    button.primary {
      background: var(--vscode-button-background);
      border-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    button.primary:hover {
      background: var(--vscode-button-hoverBackground);
      border-color: var(--vscode-button-hoverBackground);
    }
    
    .loading-dots:after {
      content: ' .';
      animation: dots 1.5s steps(5, end) infinite;
    }
    @keyframes dots {
      0%, 20% { content: ''; }
      40% { content: ' .'; }
      60% { content: ' . .'; }
      80% { content: ' . . .'; }
      100% { content: ''; }
    }
  </style>
</head>
<body>
  <div id="messages"></div>
  
  <div class="composer">
    <div class="composer-shell">
      <textarea id="prompt" placeholder="Message EminentAi..."></textarea>
      <div class="composer-footer">
        <div class="composer-left">
          <button class="icon-btn" id="clear" title="Clear chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <select id="model-select" title="Ollama model">
            <option value="">Loading models...</option>
          </select>
          <select id="mode-select" title="Mode">
            <option value="Chat">Chat</option>
            <option value="Plan">Plan</option>
            <option value="Agent">Agent</option>
          </select>
        </div>
        <div class="composer-right">
          <button class="icon-btn primary" id="send" title="Send">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="local-note">EminentAi runs entirely on this machine. Your data stays local.</div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const promptEl = document.getElementById('prompt');
    const messages = document.getElementById('messages');
    const modelSelect = document.getElementById('model-select');
    const modeSelect = document.getElementById('mode-select');
    const sendButton = document.getElementById('send');
    let currentAssistantEl = null;

    // Notify extension we are ready to receive init data
    vscode.postMessage({ type: 'ready' });

    function addMsg(cls, label, text) {
      const wrap = document.createElement('div');
      wrap.className = 'msg ' + cls;
      if (label) {
        const lab = document.createElement('div');
        lab.className = 'label';
        lab.textContent = label;
        wrap.appendChild(lab);
      }
      const body = document.createElement('div');
      body.textContent = text;
      wrap.appendChild(body);
      messages.appendChild(wrap);
      messages.scrollTop = messages.scrollHeight;
      return body;
    }

    function addAgentEvent(ev) {
      const el = document.createElement('div');
      el.className = 'agent-event ' + ev.type;
      
      switch(ev.type) {
        case 'thought':
          el.textContent = 'Thought: ' + ev.text;
          break;
        case 'tool_call':
          el.textContent = 'Running ' + ev.tool + '...';
          el.className += ' tool-call';
          break;
        case 'tool_result':
          el.textContent = ev.tool + ' result received';
          el.className += ' tool-result';
          break;
        case 'done':
          addMsg('assistant', 'Agent Result', ev.answer);
          return;
        case 'error':
          el.textContent = 'Error: ' + ev.message;
          el.className += ' err';
          break;
        default:
          el.textContent = '[' + ev.type + '] ' + (ev.text || ev.message || '');
      }
      
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
    }

    function submitPrompt() {
      const text = promptEl.value.trim();
      if (!text) return;
      addMsg('user', 'You', text);
      
      if (modeSelect.value === 'Agent') {
        const status = document.createElement('div');
        status.className = 'agent-event';
        status.innerHTML = 'Starting agent<span class="loading-dots"></span>';
        messages.appendChild(status);
      } else {
        currentAssistantEl = addMsg('assistant', modeSelect.value === 'Plan' ? 'Plan' : 'EminentAi', '');
      }
      
      vscode.postMessage({ type: 'send', text });
      promptEl.value = '';
      promptEl.style.height = 'auto';
    }

    promptEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitPrompt();
      }
    });

    sendButton.addEventListener('click', submitPrompt);

    promptEl.addEventListener('input', () => {
      promptEl.style.height = 'auto';
      promptEl.style.height = Math.min(promptEl.scrollHeight, 200) + 'px';
    });

    modelSelect.addEventListener('change', () => {
      vscode.postMessage({ type: 'setModel', model: modelSelect.value });
    });

    modeSelect.addEventListener('change', () => {
      vscode.postMessage({ type: 'setMode', mode: modeSelect.value });
      promptEl.placeholder = modeSelect.value === 'Agent' ? 'Give the agent a goal...' : 'Message EminentAi...';
    });

    document.getElementById('clear').addEventListener('click', () => {
      messages.innerHTML = '';
      vscode.postMessage({ type: 'clear' });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'init') {
        // Populate models
        modelSelect.innerHTML = '';
        msg.models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m;
          if (m === msg.selectedModel) opt.selected = true;
          modelSelect.appendChild(opt);
        });
        if (msg.models.length === 0 && msg.selectedModel) {
          const opt = document.createElement('option');
          opt.value = msg.selectedModel;
          opt.textContent = msg.selectedModel;
          opt.selected = true;
          modelSelect.appendChild(opt);
        }
        modeSelect.value = msg.mode;
        promptEl.placeholder = msg.mode === 'Agent' ? 'Give the agent a goal...' : 'Message EminentAi...';
      } else if (msg.type === 'token') {
        if (currentAssistantEl) {
          currentAssistantEl.textContent += msg.text;
          messages.scrollTop = messages.scrollHeight;
        }
      } else if (msg.type === 'clear_last_token') {
        if (currentAssistantEl) {
          currentAssistantEl.textContent = '';
        }
      } else if (msg.type === 'error') {
        if (currentAssistantEl) { 
          currentAssistantEl.classList.add('err'); 
          currentAssistantEl.textContent = msg.message; 
        } else {
          addMsg('assistant err', 'Error', msg.message);
        }
      } else if (msg.type === 'prefill') {
        promptEl.value = msg.prompt;
        promptEl.style.height = 'auto';
        promptEl.style.height = Math.min(promptEl.scrollHeight, 200) + 'px';
        promptEl.focus();
      } else if (msg.type === 'agent_event') {
        addAgentEvent(msg.event);
      }
    });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) { text += chars.charAt(Math.floor(Math.random() * chars.length)); }
  return text;
}
