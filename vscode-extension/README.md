# EminentAI — Local AI Coding Assistant for VS Code

EminentAI is a local-first coding assistant that talks to models you run yourself through [Ollama](https://ollama.com), with optional fallback to OpenAI, Anthropic, or Google if you add API keys. Nothing leaves your machine unless you explicitly configure a cloud provider.

## Requirements

- VS Code 1.90+
- [Ollama](https://ollama.com) installed and running locally (`ollama serve`, or the desktop app)
- At least one local model pulled, e.g. `ollama pull gemma4:e4b`

## Features

- **Agent mode** — reads, edits, and runs commands in your open workspace (git, npm, dotnet, docker, etc.) with an approval flow you control (ask every time, approve for the session, or full auto).
- **Ask mode** — plain Q&A against your selected model, no file/tool access.
- **Plan mode** — produces a structured implementation plan (with Mermaid diagrams for architecture requests) without touching files.
- **Auto model routing** — set the model picker to `Auto` (the default) and EminentAI will pick an appropriate local model per request, free VRAM held by anything else running before it starts, and unload/restore models afterward so idle models don't sit resident and keep your fans spinning. Agent mode always uses Auto for local models — it can't be overridden by mistake.
- **Vision hand-off** — attach screenshots/mockups and EminentAI routes them to an installed vision-capable model first, then feeds the analysis to your coding model.
- **Cloud providers (optional)** — add OpenAI / Anthropic / Google API keys in Settings to use their models alongside your local ones.
- **Task/session switcher** — click the session pill at the top of the panel to search and jump between past conversations.
- **Live task checklist** — Agent mode shows a running checklist of every step it takes (model selection, file reads/writes, commands, cooldown) as it happens; Plan mode renders its plan as clickable checkboxes.
- **Model orchestration panel** — the pill in the top-right toolbar always shows which local model is currently loaded and why (e.g. `gemma4:e4b · coding`); click it for a session log of every model stopped to free VRAM and restored afterward.
- **Automatic changelog** — whenever Agent mode edits files, a dated entry (files touched, +/- line counts, one-line summary) is appended to `CHANGELOG.md` in the workspace root.

## Installing / updating

EminentAI isn't published to the VS Code Marketplace, so it's installed from a `.vsix` file you build or receive locally. **This matters:** VS Code's Extensions view only shows an automatic "Update" or "Reload Required" prompt for extensions it downloaded from the Marketplace. A side-loaded `.vsix` is never checked for updates automatically — replacing the file on disk does nothing by itself. You have to explicitly reinstall it every time a new version is built.

### Recommended: install via terminal (most reliable)

```bash
code --install-extension /path/to/eminentai-<version>.vsix --force
```

Then reload the window: Command Palette (`Cmd/Ctrl+Shift+P`) → **Developer: Reload Window**.

### Alternative: install via the UI

1. Command Palette → **Extensions: Install from VSIX...**
2. Select the `.vsix` file.
3. When VS Code shows the "reload required" toast, click **Reload**. If you miss the toast, run **Developer: Reload Window** manually — the Extensions list won't reliably show a persistent reload button for a sideloaded install.

### Confirming you're on the right version

Open the Extensions view → search "EminentAI" → click it → check **Version** under Installation. If it still shows the old version after installing, the reload didn't happen — re-run **Developer: Reload Window**.

### Note on duplicate/similar entries

If you see more than one EminentAI-like entry in your Extensions list (e.g. one published by `eminentai` and another from an unnamed/undefined publisher), you likely have an older or unrelated build installed alongside this one. Check the **Identifier** field (should be `eminentai.eminentai`) before assuming which one is active, and uninstall the one you don't use to avoid confusion.

## Building from source

```bash
cd vscode-extension
npm install
npm run compile          # or: npm run watch
npm run package          # produces eminentai-<version>.vsix via vsce
```

Bump the `version` field in `package.json` before packaging a new build — see the note above about why this is required for updates to be recognized.

## Key settings

| Setting | Default | Purpose |
|---|---|---|
| `eminentai.ollamaUrl` | `http://localhost:11434` | Where your local Ollama server is running |
| `eminentai.defaultModel` | `auto` | Leave as `auto` unless you have a specific reason to pin a model |
| `eminentai.defaultMode` | `agent` | Starting mode for new sessions |
| `eminentai.visionModel` | *(auto-detect)* | Pin a specific vision model for image attachments |
| `eminentai.contextLines` | `50` | Lines of active-file context auto-included |
| `eminentai.maxHistoryMessages` | `20` | Conversation history sent per request |

Cloud provider keys (OpenAI/Anthropic/Google) and Azure/AWS Bedrock options are configured under **Settings → Extensions → EminentAI**.

## Troubleshooting

- **"Cannot reach Ollama"** — make sure `ollama serve` (or the Ollama desktop app) is running and reachable at the configured `ollamaUrl`.
- **No models in the picker** — click the refresh (⟳) button in the toolbar, or pull a model with `ollama pull <model>`.
- **Update not appearing after reinstall** — see [Installing / updating](#installing--updating) above; this is expected behavior for sideloaded extensions, not a bug.
- **Fans spinning during Agent mode** — expected while a local model is actively generating across a multi-step tool-calling session; EminentAI frees VRAM before and after each run, but can't eliminate the compute cost of the inference itself.
