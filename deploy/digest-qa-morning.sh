#!/usr/bin/env bash
# Morning digest QA re-check + Telegram alert on FAIL (safety net after 23:59 digest).
# Usage: bash deploy/digest-qa-morning.sh [job-id]
set -euo pipefail

HOME_DIR="${IRIDA_HOME:-${CSAGENT_HOME:-$HOME/.irida}}"
ROOT="${IRIDA_ROOT:-${CSAGENT_ROOT:-$HOME_DIR/irida}}"
RUN="$ROOT/scripts/csagent-run.sh"
JOB_ID="${1:-tparser-daily-digest}"

if [[ ! -x "$RUN" ]]; then
  echo "digest-qa-morning: missing $RUN" >&2
  exit 70
fi

# shellcheck source=/dev/null
[[ -f "$HOME_DIR/irida.env" ]] && source "$HOME_DIR/irida.env"

export IRIDA_HOME="$HOME_DIR"
export CSAGENT_ROOT="$ROOT"

exec "$RUN" cron qa "$JOB_ID" --morning --alert
