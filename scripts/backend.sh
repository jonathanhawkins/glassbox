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

# Cockpit demo backend: pace each wave of beads so the board is watchable (chips
# route into the worker docks, workers light up in parallel). Override with
# GLASSBOX_PACE_MS=0 for a flat-out headless run.
export GLASSBOX_PACE_MS="${GLASSBOX_PACE_MS:-650}"

echo "[backend] starting uvicorn on ${HOST}:${PORT} (agents.server:app), pace=${GLASSBOX_PACE_MS}ms"
exec uv run uvicorn agents.server:app --host "$HOST" --port "$PORT"
