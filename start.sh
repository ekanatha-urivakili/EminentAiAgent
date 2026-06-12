#!/bin/bash
# EminentAI startup: backend (ASP.NET Core, 127.0.0.1:5210) + web UI (Vite, :5173).
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
    echo "Stopping EminentAI..."
    kill $(jobs -p) 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# ── Ollama check ─────────────────────────────────────────────────────────────
if ! curl -s --max-time 2 http://127.0.0.1:11434/api/tags > /dev/null; then
    echo "⚠️  Ollama is not responding on 127.0.0.1:11434."
    echo "   Start it first:  brew services start ollama"
    echo "   Then pull models: ollama pull qwen2.5-coder:7b"
fi

echo "🚀 Starting EminentAI backend on http://127.0.0.1:5210 ..."
dotnet run --project src/LocalForge.Api --urls http://127.0.0.1:5210 &

echo "📦 Starting web UI ..."
(cd web && npm run dev) &

sleep 4
echo "🌐 Opening http://localhost:5173 ..."
open http://localhost:5173 2>/dev/null || true

echo "✅ EminentAI is running. Press Ctrl+C to stop."
wait
