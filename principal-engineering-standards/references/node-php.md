# Node.js and PHP Standards

## Node.js

- Use a supported LTS runtime, lockfile, reproducible installs, strict TypeScript, and ESM/CommonJS boundaries chosen deliberately.
- Never use `any`; validate untrusted inputs at runtime.
- Keep CPU-heavy work and unbounded synchronous operations off the event loop.
- Bound request bodies, streams, concurrency, queues, retries, and outbound calls; handle cancellation and shutdown.
- Centralize authentication, authorization, validation, problem responses, structured logging, and trace propagation.
- Do not log tokens, cookies, request bodies containing sensitive data, or unfiltered headers.
- Pin and audit dependencies; minimize lifecycle scripts and package privileges.

## PHP

- Use a supported PHP version, `declare(strict_types=1)`, typed properties, parameter/return types, Composer lockfiles, and PSR conventions.
- Use framework validation, authorization, CSRF protection, templating auto-escaping, and parameterized queries.
- Never deserialize untrusted PHP objects or construct SQL/commands/paths from raw input.
- Configure production error display off and structured server-side logging on.
- Keep domain rules independent of controllers, ORM entities, and framework globals.
- Use immutable value objects where they clarify invariants; avoid service locator and global mutable state.
- Run static analysis, tests, dependency audit, and migration checks in CI.
