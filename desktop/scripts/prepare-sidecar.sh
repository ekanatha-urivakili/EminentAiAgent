#!/usr/bin/env bash
# Publishes EminentAi.Api as a self-contained executable and places it under
# src-tauri/binaries with the Rust target-triple suffix Tauri's `externalBin` requires
# (see tauri.conf.json and https://tauri.app/develop/sidecar/).
set -euo pipefail
cd "$(dirname "$0")/.."

command -v dotnet >/dev/null || { echo "dotnet SDK is required" >&2; exit 1; }
command -v rustc >/dev/null || { echo "rustc is required (install via rustup)" >&2; exit 1; }

TRIPLE=$(rustc -Vv | awk '/^host:/ { print $2 }')

case "$TRIPLE" in
  x86_64-apple-darwin)   RID=osx-x64 ;;
  aarch64-apple-darwin)  RID=osx-arm64 ;;
  x86_64-pc-windows-msvc) RID=win-x64 ;;
  aarch64-pc-windows-msvc) RID=win-arm64 ;;
  x86_64-unknown-linux-gnu) RID=linux-x64 ;;
  *) echo "Unmapped Rust target triple '$TRIPLE' — add its .NET RID to prepare-sidecar.sh" >&2; exit 1 ;;
esac

OUT_DIR="$(mktemp -d)"
dotnet publish ../src/EminentAi.Api/EminentAi.Api.csproj \
  -c Release -r "$RID" --self-contained true \
  -p:PublishSingleFile=true \
  -o "$OUT_DIR"

mkdir -p src-tauri/binaries
BIN_NAME="EminentAi.Api"
if [[ "$RID" == win-* ]]; then BIN_NAME="EminentAi.Api.exe"; fi
DEST="src-tauri/binaries/eminentai-api-${TRIPLE}"
if [[ "$RID" == win-* ]]; then DEST="${DEST}.exe"; fi

cp "$OUT_DIR/$BIN_NAME" "$DEST"
chmod +x "$DEST" 2>/dev/null || true
rm -rf "$OUT_DIR"

echo "Sidecar published: $DEST"
