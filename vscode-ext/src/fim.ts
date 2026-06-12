import * as vscode from "vscode";
import { ApiClient } from "./apiClient";

const CACHE_MAX = 50;

export class FimProvider implements vscode.InlineCompletionItemProvider {
  private inflight?: AbortController;
  private cache = new Map<string, string>(); // insertion-ordered → simple LRU

  constructor(private api: ApiClient, private cfg: () => vscode.WorkspaceConfiguration) {}

  async provideInlineCompletionItems(
    doc: vscode.TextDocument, pos: vscode.Position,
    _ctx: vscode.InlineCompletionContext, token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[]> {
    if (!this.cfg().get("inlineCompletions")) { return []; }

    this.inflight?.abort(); // kill the stale request on every keystroke
    const ac = new AbortController();
    this.inflight = ac;
    token.onCancellationRequested(() => ac.abort());

    await new Promise(r => setTimeout(r, 300)); // debounce
    if (ac.signal.aborted) { return []; }

    const prefix = doc.getText(new vscode.Range(new vscode.Position(0, 0), pos)).slice(-8000);
    const suffix = doc.getText(new vscode.Range(pos, new vscode.Position(doc.lineCount, 0))).slice(0, 2000);

    const key = `${doc.uri.toString()}|${prefix.slice(-200)}`;
    let text = this.cache.get(key);
    if (text === undefined) {
      text = await this.api
        .fim(prefix, suffix, this.cfg().get<string>("fimModel")!, ac.signal)
        .catch(() => "");
      if (text) { this.put(key, text); }
    }

    if (!text || ac.signal.aborted) { return []; }
    return [new vscode.InlineCompletionItem(text, new vscode.Range(pos, pos))];
  }

  private put(key: string, value: string) {
    if (this.cache.has(key)) { this.cache.delete(key); }
    this.cache.set(key, value);
    if (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
  }
}
