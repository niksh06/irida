#!/usr/bin/env bash
#
# Manual live smoke test against the REAL Cursor SDK (not run in CI).
# Requires a working CURSOR_API_KEY in the environment.
#
#   CURSOR_API_KEY=cursor_... bash scripts/smoke.sh
#
# Runs doctor + a one-shot run + sessions in a throwaway workspace so it
# never touches your project's .agent state. Interactive `chat` and live
# `resume` are exercised manually (see README).
set -euo pipefail

PROJ="$(cd "$(dirname "$0")/.." && pwd)"
TSX="$PROJ/node_modules/.bin/tsx"
CLI="$PROJ/src/cli.ts"

if [[ -z "${CURSOR_API_KEY:-}" ]]; then
  echo "smoke: set CURSOR_API_KEY first" >&2
  exit 78
fi
if [[ ! -x "$TSX" ]]; then
  echo "smoke: run 'npm install' first (tsx missing)" >&2
  exit 70
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "smoke workspace: $WORK"

echo "== doctor =="
( cd "$WORK" && CURSOR_API_KEY="$CURSOR_API_KEY" "$TSX" "$CLI" doctor )

echo "== run =="
( cd "$WORK" && CURSOR_API_KEY="$CURSOR_API_KEY" "$TSX" "$CLI" run "Reply with exactly one word: ping" )

echo "== sessions =="
( cd "$WORK" && CURSOR_API_KEY="$CURSOR_API_KEY" "$TSX" "$CLI" sessions )

echo "smoke: OK"
