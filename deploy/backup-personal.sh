#!/usr/bin/env bash
# Backup personal irida home: PG + non-secret .agent configs.
# Usage: bash deploy/backup-personal.sh [backup-dir]
set -euo pipefail

HOME_DIR="${IRIDA_HOME:-${CSAGENT_HOME:-$HOME/.irida}}"
ROOT="${IRIDA_ROOT:-${CSAGENT_ROOT:-$HOME_DIR/irida}}"
STAMP="$(date +%Y%m%d-%H%M)"
DEST="${1:-$HOME/backups/irida-$STAMP}"

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

# Rebranded to the single OrbStack `irida` space (I-131): docker-compose.irida.yml,
# service `memory` (container irida-memory), DB irida_memory / role irida. Resolve
# the container id via compose (name-agnostic, mirrors ensure-postgres.sh).
COMPOSE="${IRIDA_PG_COMPOSE:-${CSAGENT_PG_COMPOSE:-$ROOT/deploy/docker-compose.irida.yml}}"
PG_SERVICE="${IRIDA_PG_SERVICE:-${CSAGENT_PG_SERVICE:-memory}}"
PG_USER="${IRIDA_POSTGRES_USER:-${CSAGENT_POSTGRES_USER:-irida}}"
PG_DB="${IRIDA_POSTGRES_DB:-${CSAGENT_POSTGRES_DB:-irida_memory}}"
if [[ -f "$COMPOSE" ]] && command -v docker >/dev/null 2>&1; then
  PG_CID="$(docker compose -f "$COMPOSE" ps -q "$PG_SERVICE" 2>/dev/null | head -1)"
  if [[ -n "$PG_CID" ]]; then
    DUMP="$DEST/irida_memory.pg.dump"
    docker exec -i "$PG_CID" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$DUMP"
    echo "  pg_dump -> $(basename "$DUMP") ($(wc -c < "$DUMP" | tr -d ' ') bytes)"
  else
    echo "  skip pg_dump ($PG_SERVICE container not running)"
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
