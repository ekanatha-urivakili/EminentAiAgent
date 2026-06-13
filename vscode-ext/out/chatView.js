"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatViewProvider = void 0;
const vscode = __importStar(require("vscode"));
class ChatViewProvider {
    extensionContext;
    api;
    static current;
    view;
    history = [];
    inflight;
    mode = "Chat";
    constructor(extensionContext, api) {
        this.extensionContext = extensionContext;
        this.api = api;
        ChatViewProvider.current = this;
    }
    resolveWebviewView(webviewView, _context, _token) {
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
                        selectedModel: cfg.get("chatModel"),
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
                    const model = cfg.get("chatModel");
                    if (this.mode === "Agent") {
                        await this.runAgent(data.text, model);
                    }
                    else {
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
    async runChat(text, model) {
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
            }
            catch (e) {
                this.view?.webview.postMessage({ type: "error", message: String(e) });
            }
            return;
        }
        let reply = "";
        try {
            for await (const ev of this.api.chat(this.history, model, this.inflight.signal)) {
                if (ev.type === "token") {
                    reply += ev.text;
                }
                this.view?.webview.postMessage(ev);
            }
            this.history.push({ role: "assistant", content: reply });
            if (this.history.length > 40) {
                this.history = this.history.slice(-40);
            }
        }
        catch (e) {
            if (e.name !== "AbortError") {
                this.view?.webview.postMessage({ type: "error", message: String(e) });
            }
        }
    }
    async runAgent(goal, model) {
        this.inflight?.abort();
        this.inflight = new AbortController();
        let runId;
        try {
            // Connectors are hardcoded for now as in the web app's default
            for await (const ev of this.api.runAgent(goal, model, ["filesystem", "shell"], this.inflight.signal)) {
                if (ev.type === "run_started" && ev.runId) {
                    runId = ev.runId;
                }
                if (ev.type === "approval_required") {
                    const argsPreview = JSON.stringify(ev.args ?? {}, null, 2);
                    const pick = await vscode.window.showWarningMessage(`Agent wants to run: ${ev.tool}\n${argsPreview.slice(0, 500)}`, { modal: true }, "Approve", "Reject");
                    if (runId && ev.stepId) {
                        await this.api.approve(runId, ev.stepId, pick === "Approve");
                    }
                    continue; // Don't post this to webview as it's handled via VS Code dialog for now
                }
                this.view?.webview.postMessage({ type: "agent_event", event: ev });
                if (ev.type === "done" || ev.type === "halted" || ev.type === "error") {
                    break;
                }
            }
        }
        catch (e) {
            if (e.name !== "AbortError") {
                this.view?.webview.postMessage({ type: "error", message: String(e) });
            }
        }
    }
    post(message) {
        this.view?.webview.postMessage(message);
    }
    getHtmlForWebview(webview) {
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
    
    .toolbar { 
      display: flex; 
      gap: 4px; 
      padding: 8px; 
      border-bottom: 1px solid var(--vscode-divider);
      background: var(--vscode-sideBar-background);
      z-index: 10;
    }
    
    select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 4px;
      font-size: 11px;
      padding: 2px 4px;
      outline: none;
      max-width: 120px;
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

    textarea { 
      width: 100%; 
      min-height: 60px; 
      max-height: 200px;
      box-sizing: border-box; 
      resize: none;
      background: var(--vscode-input-background); 
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent); 
      border-radius: 6px; 
      padding: 8px 10px; 
      font-family: inherit;
      font-size: var(--font-size);
      outline: none;
    }
    
    textarea:focus {
      border-color: var(--vscode-focusBorder);
    }

    .composer-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 6px;
    }

    .hint { font-size: 10px; opacity: 0.5; }
    
    button.icon-btn { 
      background: none; 
      border: none; 
      color: var(--vscode-foreground); 
      cursor: pointer; 
      opacity: 0.7;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
    }
    
    button.icon-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
    
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
  <div class="toolbar">
    <select id="mode-select" title="Change Mode">
      <option value="Chat">Chat</option>
      <option value="Plan">Plan</option>
      <option value="Agent">Agent</option>
    </select>
    <select id="model-select" title="Change Model">
      <option value="">Loading models...</option>
    </select>
    <div style="flex:1"></div>
    <button class="icon-btn" id="clear" title="Clear Chat">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
    </button>
  </div>
  
  <div id="messages"></div>
  
  <div class="composer">
    <textarea id="prompt" placeholder="Ask EminentAi…"></textarea>
    <div class="composer-footer">
      <span class="hint">Enter to send · Shift+Enter for newline</span>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const promptEl = document.getElementById('prompt');
    const messages = document.getElementById('messages');
    const modelSelect = document.getElementById('model-select');
    const modeSelect = document.getElementById('mode-select');
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
          el.textContent = '→ Running ' + ev.tool + '...';
          el.className += ' tool-call';
          break;
        case 'tool_result':
          el.textContent = '✓ ' + ev.tool + ' result received';
          el.className += ' tool-result';
          break;
        case 'done':
          addMsg('assistant', 'Agent Result', ev.answer);
          return;
        case 'error':
          el.textContent = '❌ Error: ' + ev.message;
          el.className += ' err';
          break;
        default:
          el.textContent = '[' + ev.type + '] ' + (ev.text || ev.message || '');
      }
      
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
    }

    promptEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = promptEl.value.trim();
        if (!text) return;
        addMsg('user', 'You', text);
        
        if (modeSelect.value === 'Agent') {
          const status = document.createElement('div');
          status.className = 'agent-event';
          status.innerHTML = 'Starting agent<span class="loading-dots"></span>';
          messages.appendChild(status);
        } else {
          currentAssistantEl = addMsg('assistant', 'EminentAi', '');
        }
        
        vscode.postMessage({ type: 'send', text });
        promptEl.value = '';
        promptEl.style.height = 'auto';
      }
    });

    promptEl.addEventListener('input', () => {
      promptEl.style.height = 'auto';
      promptEl.style.height = Math.min(promptEl.scrollHeight, 200) + 'px';
    });

    modelSelect.addEventListener('change', () => {
      vscode.postMessage({ type: 'setModel', model: modelSelect.value });
    });

    modeSelect.addEventListener('change', () => {
      vscode.postMessage({ type: 'setMode', mode: modeSelect.value });
      promptEl.placeholder = modeSelect.value === 'Agent' ? 'Give the agent a goal…' : 'Ask EminentAi…';
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
        modeSelect.value = msg.mode;
        promptEl.placeholder = msg.mode === 'Agent' ? 'Give the agent a goal…' : 'Ask EminentAi…';
      } else if (msg.type === 'token') {
        if (currentAssistantEl) {
          currentAssistantEl.textContent += msg.text;
          messages.scrollTop = messages.scrollHeight;
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
exports.ChatViewProvider = ChatViewProvider;
function getNonce() {
    let text = "";
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
//# sourceMappingURL=chatView.js.map