#!/usr/bin/env bash
# Run a local Redis for Glassbox (no persistence; ephemeral demo bus).
set -euo pipefail
exec redis-server --port 6379 --save "" --appendonly no --daemonize no
