#!/usr/bin/env bash
# Run automated digest QA for personal prod.
# Usage: bash deploy/digest-qa.sh [job-id]
set -euo pipefail

HOME_DIR="${IRIDA_HOME:-${CSAGENT_HOME:-$HOME/.irida}}"
ROOT="${IRIDA_ROOT:-${CSAGENT_ROOT:-$HOME_DIR/irida}}"
RUN="$ROOT/scripts/csagent-run.sh"
JOB_ID="${1:-tparser-daily-digest}"

if [[ ! -x "$RUN" ]]; then
  echo "digest-qa: missing $RUN" >&2
  exit 70
fi

# shellcheck source=/dev/null
[[ -f "$HOME_DIR/csagent.env" ]] && source "$HOME_DIR/csagent.env"

export CSAGENT_HOME="$HOME_DIR"
export CSAGENT_ROOT="$ROOT"

exec "$RUN" cron qa "$JOB_ID"
