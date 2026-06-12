import * as vscode from "vscode";
import { ChatViewProvider } from "./chatView";
import { FimProvider } from "./fim";
import { registerCommands } from "./commands";
import { ApiClient } from "./apiClient";

export function activate(ctx: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration("localforge");
  const api = new ApiClient(
    () => cfg().get<string>("backendUrl")!,
    () => cfg().get<string>("ollamaUrl")!
  );

  // 1) Chat sidebar
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(
    "localforge.chat", new ChatViewProvider(ctx, api),
    { webviewOptions: { retainContextWhenHidden: true } }
  ));

  // 2) Inline completions (all languages; gated by the localforge.inlineCompletions setting)
  ctx.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" }, new FimProvider(api, cfg)
  ));

  // 3) Commands + code actions
  registerCommands(ctx, api);

  // 4) Status bar: backend health + current model, click to switch
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "localforge.pickModel";
  statusBarItem.show();
  ctx.subscriptions.push(statusBarItem);

  const refreshStatus = async () => {
    const ok = await api.health();
    const model = cfg().get<string>("chatModel");
    statusBarItem.text = ok ? `$(zap) ${model}` : "$(warning) LocalForge offline";
    statusBarItem.tooltip = ok
      ? "LocalForge backend connected — click to switch model"
      : "LocalForge backend unreachable — start it with ./start.sh";
  };
  void refreshStatus();
  const timer = setInterval(() => void refreshStatus(), 30_000);
  ctx.subscriptions.push({ dispose: () => clearInterval(timer) });
  ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration("localforge")) { void refreshStatus(); }
  }));
}

export function deactivate() {}
