/**
 * Pure command-allowlisting policy for the `run_command` agent tool.
 *
 * Deliberately has no `vscode` import so it can be unit-tested with the plain
 * Node test runner instead of the VS Code extension test harness.
 */

/** Executables the agent is permitted to invoke via `run_command`. */
export const ALLOWED_EXECUTABLES: ReadonlySet<string> = new Set([
  'git', 'npm', 'npx', 'dotnet', 'docker', 'brew', 'code',
]);

/** `docker` subcommands the agent is permitted to invoke at all. */
export const DOCKER_ALLOWED_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'build', 'ps', 'images', 'logs', 'inspect', 'version',
]);

/** `docker` subcommands that are read-only and therefore never need approval. */
export const DOCKER_READONLY_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'ps', 'images', 'inspect', 'logs', 'version',
]);

/** `git` subcommands that are read-only and therefore never need approval. */
export const GIT_READONLY_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'remote',
]);

/**
 * Thrown when a `docker` subcommand is not in the allowlist at all (as opposed
 * to being allowed but requiring approval).
 */
export class DisallowedDockerSubcommandError extends Error {
  constructor(subcommand: string) {
    super(
      `docker subcommand is not allowlisted: ${subcommand || '(none)'}. `
      + `Only ${[...DOCKER_ALLOWED_SUBCOMMANDS].join(', ')} are permitted.`,
    );
    this.name = 'DisallowedDockerSubcommandError';
  }
}

/**
 * Computes the session-grant permission key for a `run_command` invocation.
 *
 * The key is scoped to the exact executable + subcommand (e.g. `npm:install`,
 * `docker:build`, `git-write`) so that approving one command never silently
 * grants a different, unreviewed command for the rest of the session.
 *
 * Throws `DisallowedDockerSubcommandError` if `docker` is invoked with a
 * subcommand outside the allowlist (e.g. `run`, `exec`) — those must never
 * reach the shell at all, approval or not, because they can bind-mount
 * arbitrary host paths or get code execution outside the workspace sandbox.
 */
export function commandPermission(executable: string, args: string[]): string {
  const subcommand = args[0] ?? '';

  if (executable === 'git') {
    return GIT_READONLY_SUBCOMMANDS.has(subcommand) ? 'read' : 'git-write';
  }

  if (executable === 'docker') {
    if (DOCKER_READONLY_SUBCOMMANDS.has(subcommand)) return 'read';
    if (!DOCKER_ALLOWED_SUBCOMMANDS.has(subcommand)) {
      throw new DisallowedDockerSubcommandError(subcommand);
    }
    return `docker:${subcommand}`;
  }

  // Scope the session grant to this exact executable+subcommand, not the whole
  // tool family — approving "npm install" must not also approve "npx",
  // "dotnet", "brew", or "code".
  return `${executable}:${subcommand}`;
}
