import * as vscode from 'vscode';
import { generateFim } from './llmClient';

const CACHE_MAX = 50;

/**
 * Ghost-text inline completion via fill-in-the-middle, ported from vscode-ext/src/fim.ts
 * (§15 item 5 of AGENT_2_AGENT_ARCHITECTURE.md). Gated behind `eminentai.inlineCompletions`
 * (default true) and uses `eminentai.fimModel` — leave that blank to disable without needing
 * to also flip the boolean.
 */
export class FimProvider implements vscode.InlineCompletionItemProvider {
  private inflight?: AbortController;
  private cache = new Map<string, string>(); // insertion-ordered → simple LRU

  async provideInlineCompletionItems(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    _ctx: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[]> {
    const cfg = vscode.workspace.getConfiguration('eminentai');
    if (!cfg.get<boolean>('inlineCompletions')) { return []; }
    const model = cfg.get<string>('fimModel');
    if (!model) { return []; }

    this.inflight?.abort(); // kill the stale request on every keystroke
    const ac = new AbortController();
    this.inflight = ac;
    token.onCancellationRequested(() => ac.abort());

    await new Promise(r => setTimeout(r, 300)); // debounce
    if (ac.signal.aborted) { return []; }

    const prefix = doc.getText(new vscode.Range(new vscode.Position(0, 0), pos)).slice(-8000);
    const suffix = doc.getText(new vscode.Range(pos, new vscode.Position(doc.lineCount, 0))).slice(0, 2000);

    const baseUrl = cfg.get<string>('ollamaUrl') ?? 'http://localhost:11434';
    const key = `${doc.uri.toString()}|${prefix.slice(-200)}`;
    let text = this.cache.get(key);
    if (text === undefined) {
      text = await generateFim(baseUrl, prefix, suffix, model, ac.signal);
      if (text) { this.put(key, text); }
    }

    if (!text || ac.signal.aborted) { return []; }
    return [new vscode.InlineCompletionItem(text, new vscode.Range(pos, pos))];
  }

  private put(key: string, value: string): void {
    if (this.cache.has(key)) { this.cache.delete(key); }
    this.cache.set(key, value);
    if (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
  }
}
