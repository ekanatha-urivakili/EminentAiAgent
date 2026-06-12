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
    constructor(extensionContext, api) {
        this.extensionContext = extensionContext;
        this.api = api;
        ChatViewProvider.current = this;
    }
    resolveWebviewView(webviewView, context, _token) {
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
                    const ac = new AbortController();
                    try {
                        for await (const ev of this.api.chat([{ role: "user", content: data.text }], model, ac.signal)) {
                            this.view?.webview.postMessage(ev);
                        }
                    }
                    catch (e) {
                        this.view?.webview.postMessage({ type: "error", message: String(e) });
                    }
                    break;
                }
                case "copy": {
                    await vscode.env.clipboard.writeText(data.text);
                    break;
                }
            }
        });
    }
    post(message) {
        this.view?.webview.postMessage(message);
    }
    getHtmlForWebview(webview) {
        // Basic placeholder. Real implementation loads React build.
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LocalForge Chat</title>
    <style>
      body { font-family: var(--vscode-font-family); padding: 10px; }
      textarea { width: 100%; min-height: 80px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
      #messages { margin-bottom: 10px; display: flex; flex-direction: column; gap: 8px; }
      .msg { padding: 8px; border-radius: 4px; background: var(--vscode-editor-background); }
    </style>
</head>
<body>
    <div id="messages"></div>
    <textarea id="prompt" placeholder="Ask LocalForge..."></textarea>
    <script>
      const vscode = acquireVsCodeApi();
      const prompt = document.getElementById('prompt');
      const messages = document.getElementById('messages');
      
      prompt.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const text = prompt.value;
          messages.innerHTML += '<div class="msg"><b>You:</b> ' + text + '</div>';
          vscode.postMessage({ type: 'send', text });
          prompt.value = '';
          messages.innerHTML += '<div class="msg" id="curr"><b>LocalForge:</b> </div>';
        }
      });

      window.addEventListener('message', event => {
        const msg = event.data;
        const curr = document.getElementById('curr');
        if (msg.type === 'token' && curr) {
          curr.innerHTML += msg.text.replace(/\\n/g, '<br/>');
        } else if (msg.type === 'prefill') {
          prompt.value = msg.prompt;
          prompt.focus();
        }
      });
    </script>
</body>
</html>`;
    }
}
exports.ChatViewProvider = ChatViewProvider;
//# sourceMappingURL=chatView.js.map