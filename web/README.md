# EminentAI Web App

React 19, TypeScript, Vite, Tailwind, and Zustand client for the local
EminentAI API.

## Features

- Persisted Chat and Smart Chat
- Plan creation and promotion to Agent mode
- Agent timeline, tool calls, approvals, and cancellation
- User-selected local workspace path per agent run
- Filesystem, ZIP, shell, MCP, and Ollama web-search tools
- Markdown source links and Mermaid diagram rendering
- Ollama model management, generated images, auth, Mailpit, and job search

## Run

```bash
npm install
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:5210`. Override with `VITE_API_URL`.

For web research, configure `OLLAMA_API_KEY` in the backend process.
The key is never exposed to the browser.

## Build

```bash
npm run build
npm run lint
```

Architecture: [`../docs/AIAGENT_ARCHITECTURE.md`](../docs/AIAGENT_ARCHITECTURE.md).
