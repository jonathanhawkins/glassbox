#!/usr/bin/env bash
# Start the Glassbox swarm backend (FastAPI) on port 8100.
# Never uses 8000 (reserved). Run from the repo root.
#
#   bash scripts/backend.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HOST="${BACKEND_HOST:-0.0.0.0}"
PORT="${BACKEND_PORT:-8100}"

echo "[backend] starting uvicorn on ${HOST}:${PORT} (agents.server:app)"
exec uv run uvicorn agents.server:app --host "$HOST" --port "$PORT"
