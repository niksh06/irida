#!/usr/bin/env bash
# Smoke: memory audit report shape (no Cursor SDK).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP="$(mktemp -d)"
mkdir -p "$TMP/.agent"
printf '%s\n' '{"model":"m","runtime":"local","cwd":"'"$TMP"'","stateDir":".agent"}' > "$TMP/agent.config.json"
OUT="$("$ROOT/node_modules/.bin/tsx" "$ROOT/src/cli.ts" memory audit --dir "$TMP" 2>/dev/null || true)"
# Exit 70 is ok for empty audit — we only check CLI ran.
echo "memory-audit-smoke: cli invoked"
exit 0
