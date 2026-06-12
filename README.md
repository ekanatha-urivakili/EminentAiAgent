# LocalForge — Local Ollama Copilot Platform

A fully local AI copilot: streaming chat, Plan mode, and an autonomous Agent mode with
policy-gated tools — backed by Ollama, with a React web UI and a VS Code extension.
See `local-ollama-copilot-architecture.md` for the full architecture.

## Layout

```
src/LocalForge.Domain          entities (conversations, branches, agent runs, policy)
src/LocalForge.Application    use cases: ChatService, PlannerService, AgentOrchestrator,
                              ApprovalBroker, ToolCallRepair (tool-call recovery for 7B models)
src/LocalForge.Infrastructure OllamaClient, McpHost (MCP SDK), PolicyEngine, PiiRedactor,
                              BuiltinToolRunner (sandboxed filesystem + shell), EF Core/SQLite
src/LocalForge.Api            Minimal API + SSE endpoints (127.0.0.1:5210)
web/                          React 19 + Vite + Tailwind UI (light/dark/system themes)
vscode-ext/                   VS Code extension: chat sidebar, FIM completions, agent edits
```

## Run

```bash
# prerequisites
brew services start ollama
ollama pull qwen2.5-coder:7b && ollama pull qwen2.5-coder:1.5b-base

# start Mailpit (required for password reset emails)
docker compose up -d mailpit    # SMTP :1025 · web UI http://localhost:8025

# everything at once
./start.sh
# or individually:
dotnet run --project src/LocalForge.Api      # http://127.0.0.1:5210
cd web && npm install && npm run dev         # http://localhost:5173
```

> **Schema note:** the database schema changed in this revision. Delete the old
> `src/LocalForge.Api/localforge.db*` files once before starting.

## Password reset

The admin portal supports self-service password reset via email:

1. Click **Forgot password?** on the login screen.
2. Enter your admin email. A reset link is sent to Mailpit.
3. Open Mailpit at [http://localhost:8025](http://localhost:8025) and click the link.
4. Set your new password in the form (the `?token=` in the URL pre-fills the reset form).
5. The old session is invalidated; log in with the new password.

**Mailpit** is a local mail-catcher — no email leaves your machine. SMTP config lives under
`LocalForge:Smtp` in `appsettings.json`; the default points to `127.0.0.1:1025`.

> To reset via SQLite directly (no email required):
> ```bash
> python3 -c "
> import base64, hashlib, os, sys
> pw = sys.argv[1].encode()
> salt = os.urandom(16)
> dk = hashlib.pbkdf2_hmac('sha256', pw, salt, 100000, dklen=32)
> print(base64.b64encode(salt).decode() + '.' + base64.b64encode(dk).decode())
> " 'YourNewPassword'
> sqlite3 src/LocalForge.Api/localforge.db \
>   "UPDATE AdminUsers SET PasswordHash='<hash>' WHERE Email='you@example.com';"
> ```

## Modes

- **Chat** — streaming conversation, persisted to SQLite. Regenerate creates a *sibling*
  message (never overwrites); fork branches a conversation.
- **Plan** — read-only: produces an editable numbered plan (JSON-validated with repair
  retries), promotable to Agent mode.
- **Agent** — autonomous loop with budgets (steps / tokens / wall-clock), loop detection,
  and a tool-call repair layer for small models. Ships with two built-in connectors that
  need zero setup: `filesystem` and `shell`, both sandboxed to `LocalForge:WorkspaceRoot`
  (defaults to `~/LocalForgeWorkspace`). External MCP connectors (stdio) can be registered
  via `POST /api/connectors`.

## Security model

- Binds `127.0.0.1` only; refuses non-loopback binding unless `LOCALFORGE_API_TOKEN` is set.
- CORS allowlist (Vite origins only), rate limiting, security headers.
- Policy engine: `ReadOnly` profile **denies** mutations, `ReadWrite` **asks** (human-in-the-loop
  is non-optional for writes), `Blocked` denies all. Explicit deny rules always win.
  Stripe-style refunds/payouts/transfers can never be allow-listed.
- Shell tool: always requires approval + command denylist (`rm -rf`, `sudo`, `curl | sh`, …)
  + 60 s timeout + workspace-scoped cwd. Filesystem writes require approval; path traversal blocked.
- Taint escalation: after the agent reads external (MCP) data, even allow-listed writes ask.
- Tool results are truncated, PII/secret-redacted, and wrapped as untrusted data
  (`<tool_result trust="untrusted">`) with a standing system rule against embedded instructions.
- PII redactor masks Stripe/AWS/GitHub/Slack/Google keys, JWTs, private key blocks,
  passwords, cards, SSNs before anything is persisted or sent to the model.

## API (shared by web UI and VS Code extension)

| Method | Route | Purpose |
|---|---|---|
| GET  | `/api/health` · `/api/models` | health + model list with tier tags |
| GET/POST/DELETE | `/api/conversations` | conversation CRUD |
| POST | `/api/branches/{id}/messages` | streaming chat (SSE) |
| POST | `/api/messages/{id}/regenerate` | sibling regenerate (SSE) |
| POST | `/api/branches/{id}/fork` | branch from a message |
| POST | `/api/chat` | stateless chat for the VS Code extension (SSE) |
| POST | `/api/plan` | goal → validated plan JSON |
| POST | `/api/agent/runs` | start agent run; response **is** the SSE event stream |
| POST | `/api/agent/runs/{id}/approvals/{stepId}` | approve/reject (+ remember as policy rule) |
| POST | `/api/agent/runs/{id}/cancel` | cancel a run |
| GET/POST/DELETE | `/api/connectors` | MCP connector registry |

## VS Code extension

```bash
cd vscode-ext && npm install && npm run package
code --install-extension localforge-copilot-0.1.0.vsix   # or F5 for the dev host
```

Chat sidebar (talks to the backend, falls back to direct Ollama), inline FIM completions
(`qwen2.5-coder:1.5b-base`), explain/fix/refactor/tests commands, `LocalForge: Agent Edit`
(runs the backend agent with approval prompts), status-bar model switcher.

> Agent file edits land in the backend's sandbox (`LocalForge:WorkspaceRoot`). Point that
> setting at your project folder in `appsettings.json` to let the agent edit it.
