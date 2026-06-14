import * as vscode from 'vscode';
import { ChatViewProvider } from './chatViewProvider';
import { SessionManager } from './sessionManager';
import { OllamaClient } from './ollamaClient';

export function activate(context: vscode.ExtensionContext): void {
  const cfg = vscode.workspace.getConfiguration('eminentai');
  const ollamaUrl = cfg.get<string>('ollamaUrl', 'http://localhost:11434');

  const ollamaClient = new OllamaClient(ollamaUrl);
  const sessionManager = new SessionManager(context.globalState);
  const provider = new ChatViewProvider(context.extensionUri, sessionManager, ollamaClient);

  // Register the WebviewView (also push provider itself so dispose() is called on deactivation)
  context.subscriptions.push(provider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('eminentai.newSession', () => {
      vscode.commands.executeCommand('eminentai.chatView.focus');
      // The webview will call new_session once focused
    }),

    vscode.commands.registerCommand('eminentai.openChat', async () => {
      const editor = vscode.window.activeTextEditor;
      const selected = editor?.document.getText(editor.selection) ?? '';
      await vscode.commands.executeCommand('eminentai.chatView.focus');
      if (selected) {
        // Small delay so webview has time to initialise
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
      // Extract first code block if present
      const codeMatch = /```(?:\w+)?\n([\s\S]*?)```/.exec(content);
      const toInsert = codeMatch ? codeMatch[1] : content;
      await editor.edit(builder => builder.insert(editor.selection.active, toInsert));
    }),
  );

  // React to configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('eminentai')) {
        const newUrl = vscode.workspace.getConfiguration('eminentai').get<string>('ollamaUrl', 'http://localhost:11434');
        ollamaClient.updateUrl(newUrl);
        provider.onConfigurationChanged();
      }
    })
  );

  // Show status bar hint
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(brain) EminentAI';
  statusBar.tooltip = 'Open EminentAI chat (Ctrl+Shift+I)';
  statusBar.command = 'eminentai.newSession';
  statusBar.show();
  context.subscriptions.push(statusBar);
}

export function deactivate(): void {
  // Nothing to clean up
}
