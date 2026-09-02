import * as vscode from 'vscode';
import { ChatViewProvider } from './chatViewProvider';
import { SessionManager } from './sessionManager';
import { ApprovalModeStore } from './approvalModeStore';
import { FimProvider } from './fimProvider';

export function activate(context: vscode.ExtensionContext): void {
  const sessionManager = new SessionManager(context.globalState);
  const approvalModeStore = new ApprovalModeStore(context.globalState);
  const provider = new ChatViewProvider(context.extensionUri, sessionManager, approvalModeStore);

  // §15 item 5: ghost-text inline completion, ported from vscode-ext (now retired).
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, new FimProvider())
  );

  // Register WebviewView
  context.subscriptions.push(provider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // ── Commands ────────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('eminentai.newSession', () => {
      vscode.commands.executeCommand('eminentai.chatView.focus');
    }),

    vscode.commands.registerCommand('eminentai.openChat', async () => {
      const editor = vscode.window.activeTextEditor;
      const selected = editor?.document.getText(editor.selection) ?? '';
      await vscode.commands.executeCommand('eminentai.chatView.focus');
      if (selected) {
        setTimeout(() => {
          void vscode.commands.executeCommand('eminentai.injectSelection', selected);
        }, 200);
      }
    }),

    vscode.commands.registerCommand('eminentai.injectSelection', (text: string) => {
      if (text) { provider.injectText(text); }
    }),

    vscode.commands.registerCommand('eminentai.refreshModels', () => {
      void provider.refreshModels();
    }),

    vscode.commands.registerCommand('eminentai.clearSession', () => {
      const session = sessionManager.getActive();
      if (session) {
        sessionManager.clearSession(session.id);
        vscode.window.showInformationMessage('EminentAI: Session cleared.');
      }
    }),

    vscode.commands.registerCommand('eminentai.insertAtCursor', async () => {
      const content = provider.getLastAssistantContent();
      if (!content) {
        vscode.window.showWarningMessage('EminentAI: No assistant response to insert.');
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('EminentAI: No active editor.');
        return;
      }
      const codeMatch = /```(?:\w+)?\n([\s\S]*?)```/.exec(content);
      const toInsert = codeMatch ? codeMatch[1] : content;
      await editor.edit(builder => builder.insert(editor.selection.active, toInsert));
    }),
  );

  // ── Config change listener ──────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('eminentai')) {
        provider.onConfigurationChanged();
      }
    })
  );

  // ── Status bar ──────────────────────────────────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(brain) EminentAI';
  statusBar.tooltip = 'Open EminentAI chat (Ctrl+Shift+I)';
  statusBar.command = 'eminentai.newSession';
  statusBar.show();
  context.subscriptions.push(statusBar);
}

export function deactivate(): void {
  // Nothing to clean up — disposables handled via context.subscriptions
}
