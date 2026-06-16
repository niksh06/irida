#!/usr/bin/env bash
# Post-deploy Telegram gateway smoke (I-88): allowed_updates + launchd + poll loop.
# Usage: bash deploy/gateway-smoke.sh
set -euo pipefail

HOME_DIR="${CSAGENT_HOME:-$HOME/.csagent}"
ROOT="${CSAGENT_ROOT:-$HOME_DIR/csagent}"
RUN="$ROOT/scripts/csagent-run.sh"
LOG_DIR="$HOME_DIR/logs"
GW_LOG="$LOG_DIR/gateway.log"
LABEL="ai.csagent.gateway"
MAX_LOG_AGE_SEC="${GATEWAY_SMOKE_MAX_LOG_AGE_SEC:-900}"

if [[ ! -x "$RUN" ]]; then
  echo "gateway-smoke: missing $RUN — run deploy/setup-home.sh first" >&2
  exit 70
fi

# shellcheck source=/dev/null
[[ -f "$HOME_DIR/csagent.env" ]] && source "$HOME_DIR/csagent.env"
export CSAGENT_HOME="$HOME_DIR"
export CSAGENT_ROOT="$ROOT"

fail() {
  echo "gateway-smoke: FAIL — $*" >&2
  exit 1
}

echo "== launchd gateway =="
if ! launchctl list 2>/dev/null | awk -v lbl="$LABEL" '$NF == lbl && $1 != "-" { found=1 } END { exit !found }'; then
  fail "$LABEL not running (launchctl list)"
fi
echo "ok    launchd $LABEL running"

echo ""
echo "== telegram allowed_updates (doctor) =="
if ! "$RUN" doctor 2>&1 | grep -E '^OK[[:space:]]+telegram allowed_updates:' >/dev/null; then
  fail "doctor telegram allowed_updates (run: csagent doctor)"
fi
echo "ok    doctor telegram allowed_updates"

echo ""
echo "== telegram allowed_updates (gateway status) =="
if ! "$RUN" gateway status 2>&1 | grep -Ei '^ok[[:space:]]+telegram allowed_updates' >/dev/null; then
  fail "gateway status telegram allowed_updates (run: csagent gateway status)"
fi
echo "ok    gateway status telegram allowed_updates"

echo ""
echo "== gateway poll loop (log) =="
if [[ ! -f "$GW_LOG" ]]; then
  fail "missing $GW_LOG"
fi
now=$(date +%s)
mtime=$(stat -f %m "$GW_LOG" 2>/dev/null || stat -c %Y "$GW_LOG")
age=$((now - mtime))
if [[ "$age" -gt "$MAX_LOG_AGE_SEC" ]]; then
  fail "gateway.log stale ${age}s (max ${MAX_LOG_AGE_SEC}s) — poll loop silent?"
fi
if ! tail -n 40 "$GW_LOG" | grep -E '\[gateway\] telegram (poll alive|updates=|poll ok|long-poll started|setMyCommands OK)' >/dev/null; then
  fail "no recent poll markers in gateway.log (tail 40)"
fi
echo "ok    gateway.log fresh (${age}s) with poll markers"

echo ""
echo "gateway-smoke: OK"
