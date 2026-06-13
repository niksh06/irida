#!/usr/bin/env bash
# Morning cron health re-check + Telegram alert on FAIL (I-38 safety net).
# Usage: bash deploy/prod-check-morning.sh
set -euo pipefail

HOME_DIR="${CSAGENT_HOME:-$HOME/.csagent}"
ROOT="${CSAGENT_ROOT:-$HOME_DIR/csagent}"
RUN="$ROOT/scripts/csagent-run.sh"

if [[ ! -x "$RUN" ]]; then
  echo "prod-check-morning: missing $RUN" >&2
  exit 70
fi

# shellcheck source=/dev/null
[[ -f "$HOME_DIR/csagent.env" ]] && source "$HOME_DIR/csagent.env"

export CSAGENT_HOME="$HOME_DIR"
export CSAGENT_ROOT="$ROOT"

exec "$RUN" doctor morning-alert
