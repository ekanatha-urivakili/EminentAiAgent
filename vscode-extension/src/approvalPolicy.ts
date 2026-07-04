/**
 * Pure approval-mode policy, mirroring the three modes exposed in the
 * approval-mode dropdown ("Ask for approval" / "Approve for me" / "Full
 * access"). No `vscode` import, so this is unit-testable directly.
 */

export type ApprovalMode = 'ask' | 'auto' | 'full';

export const APPROVAL_MODES: readonly ApprovalMode[] = ['ask', 'auto', 'full'];

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return typeof value === 'string' && (APPROVAL_MODES as readonly string[]).includes(value);
}

/**
 * Whether a given tool call, with the given (already-computed) permission
 * key, is considered "potentially unsafe" and therefore still worth a prompt
 * even under "Approve for me" mode.
 *
 * - Writes are confined to the workspace sandbox (`resolveInWorkspace`
 *   rejects path traversal) so they're treated as safe under auto-approve —
 *   this is the entire point of the mode, matching normal agent-edit UX.
 * - `docker` invocations are always flagged: even the allowlisted
 *   subcommands run a separate container runtime the sandbox doesn't fully
 *   control.
 * - `git-write` (commit/push/reset/checkout/etc.) is always flagged: it can
 *   mutate shared history or push to a remote.
 * - Every other non-read command is unsafe because package managers, build
 *   tools, and editor CLIs can execute repository code or mutate the machine.
 */
export function isUnsafeForAutoApprove(tool: string, permission: string): boolean {
  if (permission === 'read') return false;
  if (tool === 'write_file') return false;
  return true;
}

/**
 * Decides whether the given tool call should block on a user approval
 * prompt, for the given approval mode.
 *
 * - `ask`: prompt for everything except already-read-classified actions
 *   (matches the extension's original, always-ask behavior).
 * - `full`: never prompt. The caller is responsible for treating this as
 *   "run it" — this function does not grant any extra capability beyond
 *   what the tool/command allowlists already permit.
 * - `auto`: prompt only for actions `isUnsafeForAutoApprove` flags.
 */
export function shouldPromptForApproval(tool: string, permission: string, mode: ApprovalMode): boolean {
  if (permission === 'read') return false;
  if (mode === 'full') return false;
  if (mode === 'ask') return true;
  return isUnsafeForAutoApprove(tool, permission);
}

/**
 * Formats a millisecond timestamp as a short relative-time label matching
 * the Tasks panel ("6m", "1h", "2w"). Kept here (rather than only inline in
 * the webview's plain-JS bundle) so the exact bucketing behavior has test
 * coverage; `media/chat.html` re-implements this in plain JS since it isn't
 * part of the TypeScript build — keep the two in sync if you change either.
 */
export function formatRelativeTime(fromMs: number, nowMs: number = Date.now()): string {
  const deltaSeconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (deltaSeconds < 60) return 'now';
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(days / 365);
  return `${years}y`;
}
