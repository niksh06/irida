#!/bin/bash
# csagent watchdog (A2 script job) — deterministic health check, zero SDK tokens.
# Empty stdout = healthy (silent). Non-empty stdout = problem report → Telegram notify.
# Wire as: { "id": "watchdog", "cron": "*/30 * * * *", "script": "deploy/scripts/csagent-watchdog.sh", "notify": { ... } }
set -u

HOME_DIR="${CSAGENT_HOME:-$HOME/.csagent}"
LOG_DIR="$HOME_DIR/logs"
AGENT_DIR="$HOME_DIR/.agent"
PROBLEMS=()

# 1. Gateway log freshness (long-poll heartbeats keep mtime moving).
GW_LOG="$LOG_DIR/gateway.log"
if [ -f "$GW_LOG" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$GW_LOG" 2>/dev/null || echo 0) ))
  if [ "$AGE" -gt 3600 ]; then
    PROBLEMS+=("gateway.log stale: $((AGE / 60))min (gateway down?)")
  fi
else
  PROBLEMS+=("gateway.log missing in $LOG_DIR")
fi

# 2. Gateway error log: fresh errors in the last 30 min.
ERR_LOG="$LOG_DIR/gateway.error.log"
if [ -f "$ERR_LOG" ]; then
  ERR_AGE=$(( $(date +%s) - $(stat -f %m "$ERR_LOG" 2>/dev/null || echo 0) ))
  if [ "$ERR_AGE" -lt 1800 ]; then
    LAST_ERR=$(tail -1 "$ERR_LOG" 2>/dev/null | cut -c1-160)
    PROBLEMS+=("fresh gateway errors: $LAST_ERR")
  fi
fi

# 3. Outbox backlog (undelivered Telegram messages).
OUTBOX="$AGENT_DIR/gateway.outbox.json"
if [ -f "$OUTBOX" ]; then
  COUNT=$(python3 -c "import json;print(len(json.load(open('$OUTBOX')).get('entries',[])))" 2>/dev/null || echo 0)
  if [ "$COUNT" -gt 5 ]; then
    PROBLEMS+=("outbox backlog: $COUNT undelivered message(s)")
  fi
fi

# 4. Cron state freshness (tick runs every 5 min via launchd).
CRON_STATE="$AGENT_DIR/cron.state.json"
if [ -f "$CRON_STATE" ]; then
  CAGE=$(( $(date +%s) - $(stat -f %m "$CRON_STATE" 2>/dev/null || echo 0) ))
  if [ "$CAGE" -gt 7200 ]; then
    PROBLEMS+=("cron.state.json stale: $((CAGE / 3600))h (cron-tick dead?)")
  fi
fi

# 5. Postgres reachability — Docker Desktop dies periodically on this host (long
#    uptime without reboot), and every gateway turn needs the store (I-112).
#    Only checked when a DB URL is configured (sqlite installs skip this).
if [ -n "${CSAGENT_DATABASE_URL:-}" ] && command -v docker >/dev/null 2>&1; then
  PG_SERVICE="${CSAGENT_PG_SERVICE:-csagent-postgres}"
  if ! docker info >/dev/null 2>&1; then
    PROBLEMS+=("docker daemon down — Postgres unreachable, gateway turns will fail (try: open -a Docker)")
  else
    PG_CID="$(docker ps -q -f "name=$PG_SERVICE" 2>/dev/null | head -1)"
    if [ -z "$PG_CID" ]; then
      PROBLEMS+=("$PG_SERVICE container not running (try: deploy/scripts/ensure-postgres.sh)")
    elif ! docker exec "$PG_CID" pg_isready -U "${CSAGENT_POSTGRES_USER:-csagent}" >/dev/null 2>&1; then
      PROBLEMS+=("$PG_SERVICE not accepting connections")
    fi
  fi
fi

if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  echo "csagent watchdog: ${#PROBLEMS[@]} problem(s)"
  for p in "${PROBLEMS[@]}"; do echo "- $p"; done
fi
exit 0
