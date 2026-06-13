import * as vscode from "vscode";
import { ChatViewProvider, ChatMode } from "./chatView";
import { FimProvider } from "./fim";
import { registerCommands } from "./commands";
import { ApiClient } from "./apiClient";

const tokenKey = "eminentai.adminToken";

export function activate(ctx: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration("eminentai");
  const api = new ApiClient(
    () => cfg().get<string>("backendUrl")!,
    () => cfg().get<string>("ollamaUrl")!,
    () => ctx.secrets.get(tokenKey)
  );

  // 1) Chat sidebar
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(
    "eminentai.chat", new ChatViewProvider(ctx, api),
    { webviewOptions: { retainContextWhenHidden: true } }
  ));

  // 2) Inline completions (all languages; gated by the eminentai.inlineCompletions setting)
  ctx.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" }, new FimProvider(api, cfg)
  ));

  // 3) Commands + code actions
  registerCommands(ctx, api, tokenKey);

  // 4) Status bar: backend health + current model, click to switch
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "eminentai.pickModel";
  statusBarItem.show();
  ctx.subscriptions.push(statusBarItem);

  const refreshStatus = async () => {
    const ok = await api.health();
    const model = cfg().get<string>("chatModel");
    statusBarItem.text = ok ? `$(zap) ${model}` : "$(warning) EminentAi offline";
    statusBarItem.tooltip = ok
      ? "EminentAi backend connected — click to switch model"
      : "EminentAi backend unreachable — start it with ./start.sh";
  };
  void refreshStatus();
  const timer = setInterval(() => void refreshStatus(), 30_000);
  ctx.subscriptions.push({ dispose: () => clearInterval(timer) });
  ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async e => {
    if (e.affectsConfiguration("eminentai")) {
      void refreshStatus();
      const models = await api.listModels();
      ChatViewProvider.current?.post({
        type: "init",
        models,
        selectedModel: cfg().get<string>("chatModel"),
        mode: ChatViewProvider.current?.mode ?? "Chat"
      });
    }
  }));
}

export function deactivate() {}
