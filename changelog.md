# Changelog: Current Branch vs Main Branch

## 🚀 Major Changes

### ✅ Model Architecture Update
- **Primary Model Shift**: Replaced `qwen3.5:2b` with `qwen3:8b` as the primary classifier/agent (see [README.md](README.md#models)).
- **Model Prioritization**: Added explicit `modelSource` enum to distinguish local vs. remote models in `apiClient.ts`.
- **New Workflow**: Added GitHub Actions for VS Code extension publishing in `.github/workflows/publish-vscode-extension.yml`.

### 📁 Directory Restructuring
- Renamed `vscode-ext` to `vscode-extension` for clarity (see [README.md](README.md#installation)).
- Added `AGENTS.md` for project-specific agent documentation.
- Added `EminentAI.md` as the workspace root configuration file.

## 📦 Enhancements

### 🧠 Agent Capabilities
- **Smart Chat**: Improved routing logic with `qwen3:8b` for intent classification (see [README.md](README.md#smart-chat)).
- **Tool Integration**: Added `web` connector for Ollama web search with source URLs (see [README.md](README.md#connectors)).
- **Workspace Scoping**: Enhanced filesystem tool to support ZIP creation and targeted file operations.

### 🖼️ UI/UX Improvements
- **Chat Sidebar**: Added support for image attachments in vision-capable models (see [README.md](README.md#features)).
- **Responsive Design**: Updated padding in `chat.html` with `clamp()` for better screen adaptability.

## 🧠 Code Quality

### 🔧 Error Handling
- Added fallback mechanisms to `apiClient.ts` for handling backend API failures.
- Enhanced type safety in `workspaceAgent.ts` with explicit `AgentEvent` interface.

### 📄 Documentation
- Updated architecture diagrams in `EminentAI.md` with Mermaid blocks (HLD, LLD, SD).
- Added detailed `README.md` sections for model requirements and installation.

## 🚨 Bug Fixes

### 🛠️ UI Stability
- Addressed potential layout conflicts in `chat.html` by validating CSS changes with unit tests.
- Ensured session state synchronization between frontend and backend.

## 📌 Notes
- All changes align with the [EminentAI Workspace Instructions](EminentAI.md).
- New files (`.github/workflows/`, `AGENTS.md`, `EminentAI.md`) require approval before merging.

---
*Generated from `git diff main..HEAD` on [2023-10-15](https://github.com/your-username/your-repo/compare/main..HEAD).