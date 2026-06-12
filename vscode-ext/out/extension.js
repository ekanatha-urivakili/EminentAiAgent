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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const chatView_1 = require("./chatView");
const fim_1 = require("./fim");
const commands_1 = require("./commands");
const apiClient_1 = require("./apiClient");
class ErrorHeuristics {
    static detect(text) {
        const lower = text.toLowerCase();
        return lower.includes("error") || lower.includes("exception") || lower.includes("failed");
    }
}
async function showFixSuggestion(ctx, data) {
    const answer = await vscode.window.showInformationMessage("Terminal error detected. 💡 Fix with LocalForge?", "Fix");
    if (answer === "Fix") {
        vscode.commands.executeCommand("localforge.chat.focus");
        chatView_1.ChatViewProvider.current?.post({
            type: "prefill",
            prompt: `I got this error in the terminal, please help me fix it:\n\n\`\`\`\n${data}\n\`\`\``
        });
    }
}
async function updateStatusBar(ctx, ok) {
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    const cfg = vscode.workspace.getConfiguration("localforge");
    const model = cfg.get("chatModel");
    statusBarItem.text = ok ? `⚡ ${model}` : `⚠ Ollama offline`;
    statusBarItem.command = "localforge.pickModel";
    statusBarItem.show();
    ctx.subscriptions.push(statusBarItem);
}
function activate(ctx) {
    const cfg = () => vscode.workspace.getConfiguration("localforge");
    const api = new apiClient_1.ApiClient(() => cfg().get("backendUrl"), () => cfg().get("ollamaUrl"));
    // 1) Chat sidebar
    ctx.subscriptions.push(vscode.window.registerWebviewViewProvider("localforge.chat", new chatView_1.ChatViewProvider(ctx, api), { webviewOptions: { retainContextWhenHidden: true } }));
    // 2) Inline completions (all languages; gate via setting)
    ctx.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, new fim_1.FimProvider(api, cfg)));
    // 3) Commands + code actions
    (0, commands_1.registerCommands)(ctx, api);
    // 4) Terminal Observer (Active Troubleshooting) - requires proposed API, disabled for now
    /*
    ctx.subscriptions.push(vscode.window.onDidWriteTerminalData(e => {
      if (ErrorHeuristics.detect(e.data)) {
          // debounce or filter in a real implementation
          // showFixSuggestion(ctx, e.data);
      }
    }));
    */
    // 5) Health check → status bar item
    api.health().then(ok => updateStatusBar(ctx, ok));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map