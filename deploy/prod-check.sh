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

# Ensure the store is up first — a down Docker/Postgres makes every other check
# (doctor, gateway) fail for the wrong reason (I-112).
if [[ -f "$ROOT/deploy/scripts/ensure-postgres.sh" ]]; then
  run "postgres" bash "$ROOT/deploy/scripts/ensure-postgres.sh"
fi
run "doctor" "$RUN" doctor
run "gateway status" "$RUN" gateway status
if [[ -f "$ROOT/deploy/gateway-smoke.sh" ]]; then
  run "gateway smoke" bash "$ROOT/deploy/gateway-smoke.sh"
fi
run "cron list" "$RUN" cron list
run "launchd" launchctl list 2>/dev/null | grep -E 'csagent|PID' || true

if [[ -f "$ROOT/deploy/digest-qa.sh" ]]; then
  echo ""
  echo "== digest qa (optional) =="
  if "$ROOT/deploy/digest-qa.sh" 2>/dev/null; then
    echo "digest-qa: OK"
  else
    echo "digest-qa: skip or FAIL (run after first nightly digest)" >&2
  fi
fi

if [[ "$fail" -eq 0 ]]; then
  echo ""
  echo "prod-check: OK"
else
  echo ""
  echo "prod-check: some checks failed (see above)" >&2
  exit 1
fi
