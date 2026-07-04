import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commandPermission,
  DisallowedDockerSubcommandError,
  ALLOWED_EXECUTABLES,
  DOCKER_ALLOWED_SUBCOMMANDS,
} from './commandPolicy';

test('ALLOWED_EXECUTABLES contains exactly the documented tool families', () => {
  assert.deepEqual(
    [...ALLOWED_EXECUTABLES].sort(),
    ['brew', 'code', 'docker', 'dotnet', 'git', 'npm', 'npx'].sort(),
  );
});

test('git: read-only subcommands map to the shared "read" permission', () => {
  for (const args of [['status'], ['diff'], ['log'], ['show'], ['rev-parse'], ['ls-files'], ['remote']]) {
    assert.equal(commandPermission('git', args), 'read');
  }
});

test('git: mutating subcommands map to "git-write", not per-subcommand', () => {
  assert.equal(commandPermission('git', ['commit', '-m', 'x']), 'git-write');
  assert.equal(commandPermission('git', ['push']), 'git-write');
  assert.equal(commandPermission('git', ['reset', '--hard']), 'git-write');
  // Regression guard: approving "git commit" must also gate "git push" — both
  // collapse to the same 'git-write' bucket deliberately (git-write acts as a
  // single trust boundary), unlike other tools which are scoped per-subcommand.
  assert.equal(commandPermission('git', ['commit']), commandPermission('git', ['push']));
});

test('docker: read-only subcommands map to "read"', () => {
  for (const sub of ['ps', 'images', 'inspect', 'logs', 'version']) {
    assert.equal(commandPermission('docker', [sub]), 'read');
  }
});

test('docker: allowlisted mutating subcommand ("build") maps to a scoped permission', () => {
  assert.equal(commandPermission('docker', ['build', '.']), 'docker:build');
});

test('docker: disallowed subcommands (e.g. "run", "exec") throw before any permission is computed', () => {
  assert.throws(() => commandPermission('docker', ['run', '-v', '/:/host', 'alpine']), DisallowedDockerSubcommandError);
  assert.throws(() => commandPermission('docker', ['exec', '-it', 'x', 'sh']), DisallowedDockerSubcommandError);
  assert.throws(() => commandPermission('docker', []), DisallowedDockerSubcommandError);
});

test('docker: DOCKER_ALLOWED_SUBCOMMANDS never includes "run" or "exec"', () => {
  assert.equal(DOCKER_ALLOWED_SUBCOMMANDS.has('run'), false);
  assert.equal(DOCKER_ALLOWED_SUBCOMMANDS.has('exec'), false);
});

test('non-git/docker executables are scoped per executable+subcommand', () => {
  assert.equal(commandPermission('npm', ['install']), 'npm:install');
  assert.equal(commandPermission('npm', ['publish']), 'npm:publish');
  assert.notEqual(commandPermission('npm', ['install']), commandPermission('npm', ['publish']));
  // Regression guard: approving "npm install" must not also cover "npx", "dotnet", "brew", or "code".
  assert.notEqual(commandPermission('npm', ['install']), commandPermission('npx', ['install']));
  assert.notEqual(commandPermission('npm', ['install']), commandPermission('dotnet', ['build']));
});

test('an executable with no subcommand still produces a distinct, non-crashing permission key', () => {
  assert.equal(commandPermission('code', []), 'code:');
});
