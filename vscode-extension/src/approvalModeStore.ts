import { ApprovalMode, isApprovalMode } from './approvalPolicy';

const STORAGE_KEY = 'eminentai.approvalMode';
const DEFAULT_MODE: ApprovalMode = 'ask';

/**
 * Structural subset of `vscode.Memento` — declared locally (rather than
 * importing `vscode`) so `ApprovalModeStore` can be unit-tested with a plain
 * in-memory fake instead of the VS Code extension test harness.
 */
export interface MementoLike {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

/** Persists the global approval-mode selection across VS Code sessions. */
export class ApprovalModeStore {
  constructor(private readonly memento: MementoLike) {}

  get(): ApprovalMode {
    const stored = this.memento.get<string>(STORAGE_KEY, DEFAULT_MODE);
    return isApprovalMode(stored) ? stored : DEFAULT_MODE;
  }

  async set(mode: ApprovalMode): Promise<void> {
    await this.memento.update(STORAGE_KEY, mode);
  }
}
