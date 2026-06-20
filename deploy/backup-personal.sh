#!/usr/bin/env bash
# Backup personal csagent home: PG + non-secret .agent configs.
# Usage: bash deploy/backup-personal.sh [backup-dir]
set -euo pipefail

HOME_DIR="${IRIDA_HOME:-${CSAGENT_HOME:-$HOME/.irida}}"
ROOT="${IRIDA_ROOT:-${CSAGENT_ROOT:-$HOME_DIR/irida}}"
STAMP="$(date +%Y%m%d-%H%M)"
DEST="${1:-$HOME/backups/csagent-$STAMP}"

mkdir -p "$DEST"

# shellcheck source=/dev/null
[[ -f "$HOME_DIR/irida.env" ]] && source "$HOME_DIR/irida.env"

echo "backup-personal: dest=$DEST"

copy_json_configs() {
  local agent="$HOME_DIR/.agent"
  local out="$DEST/agent-config"
  mkdir -p "$out"
  for f in cron.jobs.json cron.state.json gateway.json gateway.peers.json agent.config.json; do
    if [[ -f "$agent/$f" ]]; then
      cp "$agent/$f" "$out/"
      echo "  copied $f"
    fi
  done
  # Never copy credentials.json into backup dir by default.
}

copy_json_configs

COMPOSE="$ROOT/deploy/docker-compose.csagent-postgres.yml"
if [[ -f "$COMPOSE" ]] && command -v docker >/dev/null 2>&1; then
  if docker compose -f "$COMPOSE" ps --status running 2>/dev/null | grep -q csagent-postgres; then
    DUMP="$DEST/csagent.pg.dump"
    docker compose -f "$COMPOSE" exec -T csagent-postgres \
      pg_dump -U csagent -Fc csagent > "$DUMP"
    echo "  pg_dump -> $(basename "$DUMP") ($(wc -c < "$DUMP" | tr -d ' ') bytes)"
  else
    echo "  skip pg_dump (csagent-postgres not running)"
  fi
else
  echo "  skip pg_dump (docker compose file or docker missing)"
fi

if [[ -d "$HOME_DIR/logs" ]]; then
  mkdir -p "$DEST/logs-tail"
  for log in gateway.log gateway.error.log cron-tick.log cron-tick.error.log; do
    if [[ -f "$HOME_DIR/logs/$log" ]]; then
      tail -n 200 "$HOME_DIR/logs/$log" > "$DEST/logs-tail/$log"
    fi
  done
  echo "  logs tail (200 lines each) -> logs-tail/"
fi

echo "backup-personal: done → $DEST"
