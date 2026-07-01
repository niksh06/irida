#!/usr/bin/env bash
# Personal prod health pass — doctor, gateway, cron. For the ~/.irida home install.
# Usage: bash deploy/prod-check.sh
set -euo pipefail

HOME_DIR="${IRIDA_HOME:-${CSAGENT_HOME:-$HOME/.irida}}"
ROOT="${IRIDA_ROOT:-${CSAGENT_ROOT:-$HOME_DIR/irida}}"
RUN="$ROOT/scripts/csagent-run.sh"

if [[ ! -x "$RUN" ]]; then
  echo "prod-check: missing $RUN — run deploy/setup-home.sh first" >&2
  exit 70
fi

# shellcheck source=/dev/null
if [[ -f "$HOME_DIR/irida.env" ]]; then
  source "$HOME_DIR/irida.env"
elif [[ -f "$HOME_DIR/csagent.env" ]]; then
  source "$HOME_DIR/csagent.env"
fi

export IRIDA_HOME="$HOME_DIR"
export IRIDA_ROOT="$ROOT"
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

# Post-rebrand services are ai.irida.* — check each label explicitly instead of
# grepping `launchctl list` output through a pipe (a pipe runs `run` in a
# subshell, silently losing fail=1).
check_launchd() {
  local missing=0
  for label in ai.irida.gateway ai.irida.cron-tick; do
    if launchctl list "$label" >/dev/null 2>&1; then
      echo "  $label loaded"
    else
      echo "  $label NOT LOADED" >&2
      missing=1
    fi
  done
  return "$missing"
}
run "launchd" check_launchd

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
