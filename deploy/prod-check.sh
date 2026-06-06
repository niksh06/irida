#!/usr/bin/env bash
# Personal prod health pass — doctor, gateway, cron. For ~/.csagent home install.
# Usage: bash deploy/prod-check.sh
set -euo pipefail

HOME_DIR="${CSAGENT_HOME:-$HOME/.csagent}"
ROOT="${CSAGENT_ROOT:-$HOME_DIR/csagent}"
RUN="$ROOT/scripts/csagent-run.sh"

if [[ ! -x "$RUN" ]]; then
  echo "prod-check: missing $RUN — run deploy/setup-home.sh first" >&2
  exit 70
fi

# shellcheck source=/dev/null
[[ -f "$HOME_DIR/csagent.env" ]] && source "$HOME_DIR/csagent.env"

export CSAGENT_HOME="$HOME_DIR"
export CSAGENT_ROOT="$ROOT"

fail=0
run() {
  echo ""
  echo "== $1 =="
  shift
  if ! "$@"; then
    echo "prod-check: FAIL — $1" >&2
    fail=1
  fi
}

run "doctor" "$RUN" doctor
run "gateway status" "$RUN" gateway status
run "cron list" "$RUN" cron list
run "launchd" launchctl list 2>/dev/null | grep -E 'csagent|PID' || true

if [[ "$fail" -eq 0 ]]; then
  echo ""
  echo "prod-check: OK"
else
  echo ""
  echo "prod-check: some checks failed (see above)" >&2
  exit 1
fi
