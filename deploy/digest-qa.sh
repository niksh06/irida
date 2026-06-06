#!/usr/bin/env bash
# Run automated digest QA for personal prod.
# Usage: bash deploy/digest-qa.sh [job-id]
set -euo pipefail

HOME_DIR="${CSAGENT_HOME:-$HOME/.csagent}"
ROOT="${CSAGENT_ROOT:-$HOME_DIR/csagent}"
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
