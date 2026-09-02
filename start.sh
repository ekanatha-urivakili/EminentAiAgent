#!/bin/bash
# EminentAi startup: backend (ASP.NET Core, 127.0.0.1:5210) + web UI (Vite, :5173).
set -e

# ── kill any stale processes on the ports we need ────────────────────────────
kill_port() {
    local port=$1
    local pids
    pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "   Freeing port $port (pid $pids)..."
        kill -9 $pids 2>/dev/null || true
        sleep 0.4
    fi
}

kill_port 5210
kill_port 5173

# ── cleanup on Ctrl+C ────────────────────────────────────────────────────────
cleanup() {
    echo ""
    echo "Stopping EminentAi..."
    kill $(jobs -p) 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# ── Ollama check ─────────────────────────────────────────────────────────────
if ! curl -s --max-time 2 http://127.0.0.1:11434/api/tags > /dev/null; then
    echo "⚠️  Ollama is not responding on 127.0.0.1:11434."
    echo "   Start it first:  brew services start ollama"
    echo "   Then pull models: ollama pull gemma4:e4b && ollama pull qwen3-vl:latest && ollama pull ornith-1.5:9b && ollama pull qwen3.5:4b && ollama pull x/flux2-klein:4b"
fi

echo "🚀 Starting EminentAi backend on http://127.0.0.1:5210 ..."
dotnet run --project src/EminentAi.Api --urls http://127.0.0.1:5210 &

echo "📦 Starting web UI ..."
(cd web && npm run dev) &

sleep 4
echo "🌐 Opening http://localhost:5173 ..."
open http://localhost:5173 2>/dev/null || true

echo "✅ EminentAi is running. Press Ctrl+C to stop."
wait
