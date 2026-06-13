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
const tokenKey = "eminentai.adminToken";
function activate(ctx) {
    const cfg = () => vscode.workspace.getConfiguration("eminentai");
    const api = new apiClient_1.ApiClient(() => cfg().get("backendUrl"), () => cfg().get("ollamaUrl"), () => ctx.secrets.get(tokenKey));
    // 1) Chat sidebar
    ctx.subscriptions.push(vscode.window.registerWebviewViewProvider("eminentai.chat", new chatView_1.ChatViewProvider(ctx, api), { webviewOptions: { retainContextWhenHidden: true } }));
    // 2) Inline completions (all languages; gated by the eminentai.inlineCompletions setting)
    ctx.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, new fim_1.FimProvider(api, cfg)));
    // 3) Commands + code actions
    (0, commands_1.registerCommands)(ctx, api, tokenKey);
    // 4) Status bar: backend health + current model, click to switch
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = "eminentai.pickModel";
    statusBarItem.show();
    ctx.subscriptions.push(statusBarItem);
    const refreshStatus = async () => {
        const ok = await api.health();
        const model = cfg().get("chatModel");
        statusBarItem.text = ok ? `$(zap) ${model}` : "$(warning) EminentAi offline";
        statusBarItem.tooltip = ok
            ? "EminentAi backend connected — click to switch model"
            : "EminentAi backend unreachable — start it with ./start.sh";
    };
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), 30_000);
    ctx.subscriptions.push({ dispose: () => clearInterval(timer) });
    ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration("eminentai")) {
            void refreshStatus();
            const models = await api.listModels();
            chatView_1.ChatViewProvider.current?.post({
                type: "init",
                models,
                selectedModel: cfg().get("chatModel"),
                mode: chatView_1.ChatViewProvider.current?.mode ?? "Chat"
            });
        }
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map