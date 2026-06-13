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
                case "send": {
                    const cfg = vscode.workspace.getConfiguration("localforge");
                    const model = cfg.get("chatModel");
                    this.history.push({ role: "user", content: data.text });
                    this.inflight?.abort();
                    this.inflight = new AbortController();
                    let reply = "";
                    try {
                        for await (const ev of this.api.chat(this.history, model, this.inflight.signal)) {
                            if (ev.type === "token") {
                                reply += ev.text;
                            }
                            this.view?.webview.postMessage(ev);
                        }
                        this.history.push({ role: "assistant", content: reply });
                        // Bound webview-side history growth
                        if (this.history.length > 40) {
                            this.history = this.history.slice(-40);
                        }
                    }
                    catch (e) {
                        if (e.name !== "AbortError") {
                            this.view?.webview.postMessage({ type: "error", message: String(e) });
                        }
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
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LocalForge Chat</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 8px; display: flex; flex-direction: column; height: 95vh; margin: 0; }
    #messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-bottom: 8px; }
    .msg { padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.5; }
    .user { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
    .assistant { background: var(--vscode-editor-inactiveSelectionBackground); }
    .label { font-size: 10px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
    .err { color: var(--vscode-errorForeground); }
    textarea { width: 100%; min-height: 64px; box-sizing: border-box; resize: vertical;
               background: var(--vscode-input-background); color: var(--vscode-input-foreground);
               border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 8px; font-family: inherit; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; margin: 4px 0; }
    button { background: none; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; font-size: 11px; padding: 2px 4px; }
  </style>
</head>
<body>
  <div id="messages"></div>
  <div class="toolbar"><span style="font-size:11px;opacity:.6">Enter to send · Shift+Enter for newline</span><button id="clear">Clear</button></div>
  <textarea id="prompt" placeholder="Ask LocalForge…"></textarea>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const promptEl = document.getElementById('prompt');
    const messages = document.getElementById('messages');
    let currentEl = null;

    function addMsg(cls, label, text) {
      const wrap = document.createElement('div');
      wrap.className = 'msg ' + cls;
      const lab = document.createElement('div');
      lab.className = 'label';
      lab.textContent = label;
      const body = document.createElement('div');
      body.textContent = text;
      wrap.appendChild(lab);
      wrap.appendChild(body);
      messages.appendChild(wrap);
      messages.scrollTop = messages.scrollHeight;
      return body;
    }

    promptEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = promptEl.value.trim();
        if (!text) return;
        addMsg('user', 'You', text);
        currentEl = addMsg('assistant', 'LocalForge', '');
        vscode.postMessage({ type: 'send', text });
        promptEl.value = '';
      }
    });

    document.getElementById('clear').addEventListener('click', () => {
      messages.innerHTML = '';
      vscode.postMessage({ type: 'clear' });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'token' && currentEl) {
        currentEl.textContent += msg.text;
        messages.scrollTop = messages.scrollHeight;
      } else if (msg.type === 'error') {
        if (currentEl) { currentEl.classList.add('err'); currentEl.textContent = msg.message; }
      } else if (msg.type === 'prefill') {
        promptEl.value = msg.prompt;
        promptEl.focus();
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