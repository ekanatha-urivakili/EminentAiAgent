# EminentAi Desktop (Tauri 2)

Implements the architecture in [`../AI_DESKTOP_APP_ARCHI.md`](../AI_DESKTOP_APP_ARCHI.md) §5.3: a
thin Tauri 2 native host that loads the existing `web/` React build and supervises the existing
`EminentAi.Api` ASP.NET Core backend as a local sidecar process on `127.0.0.1:5210`. No application
logic (chat, agent, routing, image generation) is reimplemented here — the desktop app is a native
shell around the same backend and frontend the browser-hosted app already uses.

**Status: scaffolded, not build-verified.** This was written to the Tauri 2 / `externalBin` sidecar
spec, but this development environment has no Rust/Cargo toolchain installed, so `tauri dev` /
`tauri build` have not actually been run here. Treat `src-tauri/` as a starting point to build and
fix up locally, not as a tested artifact.

## Prerequisites

- Rust + Cargo (via [rustup](https://rustup.rs))
- .NET 10 SDK (already required by the rest of this repo)
- Node.js (already required by `web/`)
- Platform build tools Tauri needs — see https://v2.tauri.app/start/prerequisites/

## How it fits together

1. `npm run build-web` builds `web/` with `VITE_API_URL=http://127.0.0.1:5210` baked in, so the
   packaged frontend always calls the sidecar directly instead of relying on Vite's dev-only proxy
   (`web/vite.config.ts`).
2. `npm run prepare-sidecar` (`scripts/prepare-sidecar.sh`) publishes `EminentAi.Api` as a
   self-contained single-file executable for your platform and copies it into
   `src-tauri/binaries/eminentai-api-<rust-target-triple>[.exe]`, the naming Tauri's
   `bundle.externalBin` requires.
3. `src-tauri/src/main.rs` spawns that sidecar on startup via `tauri-plugin-shell`, polls the
   backend's existing `/api/health` endpoint until it responds (or a 20s timeout), then shows the
   window. On window close, it kills the sidecar so it doesn't keep running in the background
   holding the GPU lease or loaded Ollama models.

## Commands

```sh
npm install         # installs @tauri-apps/cli locally
npm run dev          # build web, publish sidecar, launch in dev mode
npm run build        # build web, publish sidecar, produce a platform installer
```

## Known gaps vs. `AI_DESKTOP_APP_ARCHI.md`

- No code signing / notarization wired up (§5.20, FR-20) — `bundle` targets are declared but
  producing a signed, distributable installer needs platform certificates this environment doesn't
  have.
- No app icons yet — `tauri.conf.json` references `icons/` files that don't exist. Generate them
  with `npx tauri icon ../web/public/brand/eminentai-icon-512.png` once the CLI is installed.
- Auto-update, Ollama detection/guided-install (FR-19), and idle-RSS/cold-start measurement (NFR-1,
  NFR-2) are not implemented — this scaffold only covers the sidecar-supervision mechanism itself.
