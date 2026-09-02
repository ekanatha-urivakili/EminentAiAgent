// Thin native host per AI_DESKTOP_APP_ARCHI.md §5.3: supervise the existing ASP.NET Core API as a
// local sidecar process instead of reimplementing chat/agent/routing logic natively. The window
// loads the same React build served from `web/dist` (see tauri.conf.json's `frontendDist`); all
// application logic still runs in the .NET sidecar, reached over loopback HTTP/SSE exactly as the
// browser-hosted dev build reaches it today (see web/src/lib/api.ts's `VITE_API_URL`).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, WindowEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// Matches EminentAi.Api's launchSettings.json `applicationUrl` (src/EminentAi.Api/Properties/launchSettings.json).
const API_HEALTH_URL: &str = "http://127.0.0.1:5210/api/health";
const API_STARTUP_TIMEOUT: Duration = Duration::from_secs(20);

struct SidecarHandle(Mutex<Option<CommandChild>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarHandle(Mutex::new(None)))
        .setup(|app| {
            let (_events, child) = app
                .shell()
                .sidecar("eminentai-api")
                .expect("eminentai-api sidecar binary not found — run scripts/prepare-sidecar.sh first")
                .spawn()
                .expect("failed to spawn eminentai-api sidecar");

            *app.state::<SidecarHandle>().0.lock().unwrap() = Some(child);

            wait_for_backend_health();

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Kill the sidecar when the window closes — it has no lifecycle of its own otherwise
            // and would keep running (and holding the GPU lease / loaded Ollama models) in the
            // background.
            if let WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<SidecarHandle>();
                if let Some(child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running eminentai desktop");
}

/// Polls the sidecar's existing `/api/health` endpoint (EminentAi.Api/Program.cs) so the window
/// isn't shown against a backend that hasn't finished starting yet. Shows the window anyway after
/// the timeout rather than hanging forever — the UI's own error states take over from there.
fn wait_for_backend_health() {
    let deadline = Instant::now() + API_STARTUP_TIMEOUT;
    while Instant::now() < deadline {
        if let Ok(resp) = ureq::get(API_HEALTH_URL).timeout(Duration::from_secs(2)).call() {
            if resp.status() == 200 {
                return;
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    eprintln!(
        "eminentai-api did not report healthy within {:?}; showing window anyway",
        API_STARTUP_TIMEOUT
    );
}
