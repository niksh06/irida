#!/usr/bin/env bash
# Run csagent from CSAGENT_ROOT; runtime state in CSAGENT_HOME/.agent (launchd friendly).
set -euo pipefail

ENV_FILE="${CSAGENT_ENV:-$HOME/.csagent/csagent.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

CSAGENT_HOME="${CSAGENT_HOME:-$HOME/.csagent}"
CSAGENT_ROOT="${CSAGENT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
export CSAGENT_HOME CSAGENT_ROOT

TSX="${CSAGENT_ROOT}/node_modules/.bin/tsx"
CLI="${CSAGENT_ROOT}/src/cli.ts"

if [[ ! -f "$TSX" ]]; then
  echo "csagent-run: missing tsx at $TSX — run npm install in $CSAGENT_ROOT" >&2
  exit 78
fi

cd "$CSAGENT_ROOT"
exec node "$TSX" "$CLI" "$@"
