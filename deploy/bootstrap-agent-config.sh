#!/usr/bin/env bash
# Bootstrap MCP-first agent.config in home install (no memory.onStart).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CSAGENT_ROOT="${IRIDA_ROOT:-${CSAGENT_ROOT:-$HOME/.irida/irida}}"
DEST="$CSAGENT_ROOT/agent.config.json"
if [[ -f "$DEST" ]]; then
  echo "exists: $DEST"
  exit 0
fi
cp "$ROOT/deploy/agent.config.example.json" "$DEST"
echo "created: $DEST"
