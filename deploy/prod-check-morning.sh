#!/usr/bin/env bash
# Morning cron health re-check + Telegram alert on FAIL (I-38 safety net).
# Usage: bash deploy/prod-check-morning.sh
set -euo pipefail

HOME_DIR="${IRIDA_HOME:-${CSAGENT_HOME:-$HOME/.irida}}"
ROOT="${IRIDA_ROOT:-${CSAGENT_ROOT:-$HOME_DIR/irida}}"
RUN="$ROOT/scripts/csagent-run.sh"

if [[ ! -x "$RUN" ]]; then
  echo "prod-check-morning: missing $RUN" >&2
  exit 70
fi

# shellcheck source=/dev/null
[[ -f "$HOME_DIR/irida.env" ]] && source "$HOME_DIR/irida.env"

export IRIDA_HOME="$HOME_DIR"
export CSAGENT_ROOT="$ROOT"

exec "$RUN" doctor morning-alert
