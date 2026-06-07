#!/usr/bin/env bash
# Start the MCP Agent Mail server (Dicklesworthstone/mcp_agent_mail), the real
# coordination fabric the swarm sends messages and takes file leases over.
#
# The swarm talks to it over HTTP (see agents/agentmail.py); the cockpit reads the
# mirrored thread from Redis. If this server is not running the swarm still works,
# it just coordinates via the Redis mirror only (rows show as not-live).
#
#   bash scripts/agent_mail.sh
#
# Config (from .env, with sane defaults):
#   AGENT_MAIL_HOME   path to the mcp_agent_mail package (has its own .env: port,
#                     bearer token, storage). The server is a dependency, not
#                     vendored into this repo.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Load AGENT_MAIL_HOME from .env if present (without leaking other secrets).
if [ -f .env ]; then
  AGENT_MAIL_HOME="${AGENT_MAIL_HOME:-$(grep -E '^AGENT_MAIL_HOME=' .env | tail -1 | cut -d= -f2-)}"
fi
# Neutral default (where the install.sh below typically drops it). Set AGENT_MAIL_HOME
# in .env to point at wherever your checkout actually lives.
AGENT_MAIL_HOME="${AGENT_MAIL_HOME:-$HOME/mcp_agent_mail}"

if [ ! -d "$AGENT_MAIL_HOME" ]; then
  echo "[agent-mail] package not found at: $AGENT_MAIL_HOME" >&2
  echo "[agent-mail] set AGENT_MAIL_HOME in .env, or install it per the PRD:" >&2
  echo '  curl -fsSL "https://raw.githubusercontent.com/Dicklesworthstone/mcp_agent_mail/main/scripts/install.sh" | bash -s -- --yes' >&2
  exit 1
fi

cd "$AGENT_MAIL_HOME"
echo "[agent-mail] starting serve-http from $AGENT_MAIL_HOME (reads its own .env: host/port/token)"
exec uv run python -m mcp_agent_mail.cli serve-http
