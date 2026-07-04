import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isUnsafeForAutoApprove,
  shouldPromptForApproval,
  formatRelativeTime,
  isApprovalMode,
  APPROVAL_MODES,
} from './approvalPolicy';

// ── isApprovalMode ───────────────────────────────────────────────────────────

test('isApprovalMode accepts exactly the three known modes', () => {
  for (const mode of APPROVAL_MODES) assert.equal(isApprovalMode(mode), true);
  assert.equal(isApprovalMode('yolo'), false);
  assert.equal(isApprovalMode(undefined), false);
  assert.equal(isApprovalMode(42), false);
});

// ── isUnsafeForAutoApprove ───────────────────────────────────────────────────

test('read permission is never unsafe', () => {
  assert.equal(isUnsafeForAutoApprove('run_command', 'read'), false);
});

test('write_file is never flagged unsafe (sandboxed to the workspace)', () => {
  assert.equal(isUnsafeForAutoApprove('write_file', 'write:src/foo.ts'), false);
});

test('any docker permission is flagged unsafe, even allowlisted subcommands', () => {
  assert.equal(isUnsafeForAutoApprove('docker', 'docker:build'), true);
});

test('git-write is flagged unsafe', () => {
  assert.equal(isUnsafeForAutoApprove('git', 'git-write'), true);
});

test('commands that can execute repository code are flagged unsafe', () => {
  assert.equal(isUnsafeForAutoApprove('npm', 'npm:install'), true);
  assert.equal(isUnsafeForAutoApprove('npx', 'npx:eslint'), true);
  assert.equal(isUnsafeForAutoApprove('dotnet', 'dotnet:build'), true);
  assert.equal(isUnsafeForAutoApprove('brew', 'brew:install'), true);
  assert.equal(isUnsafeForAutoApprove('code', 'code:--install-extension'), true);
});

// ── shouldPromptForApproval ──────────────────────────────────────────────────

test('"ask" mode always prompts for non-read permissions', () => {
  assert.equal(shouldPromptForApproval('write_file', 'write:a.ts', 'ask'), true);
  assert.equal(shouldPromptForApproval('npm', 'npm:install', 'ask'), true);
  assert.equal(shouldPromptForApproval('docker', 'docker:build', 'ask'), true);
});

test('"ask" mode never prompts for read permissions', () => {
  assert.equal(shouldPromptForApproval('run_command', 'read', 'ask'), false);
});

test('"full" mode never prompts, regardless of permission', () => {
  assert.equal(shouldPromptForApproval('write_file', 'write:a.ts', 'full'), false);
  assert.equal(shouldPromptForApproval('docker', 'docker:build', 'full'), false);
  assert.equal(shouldPromptForApproval('git', 'git-write', 'full'), false);
});

test('"auto" mode only prompts for actions flagged unsafe', () => {
  assert.equal(shouldPromptForApproval('write_file', 'write:a.ts', 'auto'), false);
  assert.equal(shouldPromptForApproval('npm', 'npm:install', 'auto'), true);
  assert.equal(shouldPromptForApproval('docker', 'docker:build', 'auto'), true);
  assert.equal(shouldPromptForApproval('git', 'git-write', 'auto'), true);
});

// ── formatRelativeTime ───────────────────────────────────────────────────────

test('formatRelativeTime buckets across the expected ranges', () => {
  const now = Date.parse('2026-07-04T12:00:00Z');
  assert.equal(formatRelativeTime(now - 5_000, now), 'now');
  assert.equal(formatRelativeTime(now - 6 * 60_000, now), '6m');
  assert.equal(formatRelativeTime(now - 60 * 60_000, now), '1h');
  assert.equal(formatRelativeTime(now - 2 * 7 * 24 * 60 * 60_000, now), '2w');
  assert.equal(formatRelativeTime(now - 13 * 30 * 24 * 60 * 60_000, now), '1y');
});

test('formatRelativeTime never returns a negative duration for a future timestamp', () => {
  const now = Date.parse('2026-07-04T12:00:00Z');
  assert.equal(formatRelativeTime(now + 60_000, now), 'now');
});
