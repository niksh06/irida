#!/usr/bin/env bash
# Backup personal irida home (H-8 v2): PG dump + agent state + configs +
# secrets env, with retention and an integrity check.
#
# Usage:
#   bash deploy/backup-personal.sh [backup-dir]     # backup + verify + retention
#   bash deploy/backup-personal.sh --drill          # + restore drill into an
#                                                   #   ephemeral docker PG
#
# Contents (v2 — audit 2026-07-02 H-8: agent.config.json was backed up from a
# WRONG path, i.e. never):
#   - pg_dump -Fc of irida_memory (+ pg_restore --list integrity check)
#   - $IRIDA_HOME/agent.config.json and $IRIDA_ROOT/agent.config.json
#   - .agent state: cron jobs/state, gateway configs/peers/pairing/engines,
#     outbox, pending questions, telegram offset, evolution proposals,
#     memory-* state, state.sqlite, .agent/memory/ (file notes)
#   - irida.env (0600 — the ONLY carrier of IRIDA_SECRETS_KEY; local disk only)
#   - log tails (200 lines)
#
# NOT included: .agent/browser (282MB Chromium profile — recreatable),
# node_modules/dist, credentials.json (PG store is the canon; env is enough).
#
# Offsite: NOT implemented on purpose — irida.env in the archive means any
# offsite copy must be encrypted first; key management is a user decision.
# Retention: newest $BACKUP_KEEP (default 8) irida-* dirs under ~/backups.
set -euo pipefail

HOME_DIR="${IRIDA_HOME:-${CSAGENT_HOME:-$HOME/.irida}}"
ROOT="${IRIDA_ROOT:-${CSAGENT_ROOT:-$HOME_DIR/irida}}"
STAMP="$(date +%Y%m%d-%H%M)"
BACKUP_BASE="$HOME/backups"
KEEP="${BACKUP_KEEP:-8}"
DRILL=0
DEST=""
for arg in "$@"; do
  case "$arg" in
    --drill) DRILL=1 ;;
    *) DEST="$arg" ;;
  esac
done
DEST="${DEST:-$BACKUP_BASE/irida-$STAMP}"

mkdir -p "$DEST"
chmod 700 "$DEST"

# shellcheck source=/dev/null
[[ -f "$HOME_DIR/irida.env" ]] && source "$HOME_DIR/irida.env"

echo "backup-personal: dest=$DEST"

copy_state() {
  local agent="$HOME_DIR/.agent"
  local out="$DEST/agent-state"
  mkdir -p "$out"
  local files=(
    cron.jobs.json cron.state.json
    gateway.json gateway.peers.json gateway.pairing.json gateway.engines.json
    gateway.outbox.json gateway.pending-questions.json gateway.telegram.offset
    evolution.proposals.json background-pause.json
    memory-audit.last.json memory-consolidate.state.json memory-distill.state.json
    state.sqlite pet-state.json
  )
  for f in "${files[@]}"; do
    if [[ -f "$agent/$f" ]]; then
      cp "$agent/$f" "$out/"
      echo "  state: $f"
    fi
  done
  if [[ -d "$agent/memory" ]]; then
    cp -R "$agent/memory" "$out/memory"
    echo "  state: memory/ ($(du -sh "$agent/memory" | cut -f1))"
  fi
  # Never copy credentials.json: the pgcrypto store (in the PG dump) is canon.
}

copy_configs() {
  local out="$DEST/configs"
  mkdir -p "$out"
  # The HOME config drives the gateway; the ROOT one (if present) drives runs
  # started from the prod repo copy. Audit H-8: the old script looked in
  # .agent/ and therefore backed up NEITHER.
  [[ -f "$HOME_DIR/agent.config.json" ]] && cp "$HOME_DIR/agent.config.json" "$out/agent.config.home.json" && echo "  config: agent.config.json (home)"
  [[ -f "$ROOT/agent.config.json" ]] && cp "$ROOT/agent.config.json" "$out/agent.config.root.json" && echo "  config: agent.config.json (root)"
  if [[ -f "$HOME_DIR/irida.env" ]]; then
    cp "$HOME_DIR/irida.env" "$out/irida.env"
    chmod 600 "$out/irida.env"
    echo "  config: irida.env (0600 — contains secrets; local disk only)"
  fi
}

copy_state
copy_configs

# Rebranded to the single OrbStack `irida` space (I-131): docker-compose.irida.yml,
# service `memory` (container irida-memory), DB irida_memory / role irida. Resolve
# the container id via compose (name-agnostic, mirrors ensure-postgres.sh).
COMPOSE="${IRIDA_PG_COMPOSE:-${CSAGENT_PG_COMPOSE:-$ROOT/deploy/docker-compose.irida.yml}}"
PG_SERVICE="${IRIDA_PG_SERVICE:-${CSAGENT_PG_SERVICE:-memory}}"
PG_USER="${IRIDA_POSTGRES_USER:-${CSAGENT_POSTGRES_USER:-irida}}"
PG_DB="${IRIDA_POSTGRES_DB:-${CSAGENT_POSTGRES_DB:-irida_memory}}"
DUMP=""
PG_CID=""
if [[ -f "$COMPOSE" ]] && command -v docker >/dev/null 2>&1; then
  PG_CID="$(docker compose -f "$COMPOSE" ps -q "$PG_SERVICE" 2>/dev/null | head -1)"
  if [[ -n "$PG_CID" ]]; then
    DUMP="$DEST/irida_memory.pg.dump"
    docker exec -i "$PG_CID" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$DUMP"
    echo "  pg_dump -> $(basename "$DUMP") ($(wc -c < "$DUMP" | tr -d ' ') bytes)"
    # Integrity: a custom-format dump that pg_restore can list is readable.
    if docker exec -i "$PG_CID" pg_restore --list < "$DUMP" > /dev/null 2>&1; then
      echo "  pg_dump verify: pg_restore --list OK"
    else
      echo "  WARN pg_dump verify FAILED — dump may be unusable" >&2
    fi
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

# Checksums manifest — lets a future restore detect bit-rot / partial copies.
( cd "$DEST" && find . -type f ! -name checksums.sha256 -exec shasum -a 256 {} + > checksums.sha256 )
echo "  checksums.sha256 ($(wc -l < "$DEST/checksums.sha256" | tr -d ' ') files)"

# Restore drill (--drill): restore the dump into an ephemeral postgres and
# count tables — proof the backup actually restores, not just exists.
if [[ "$DRILL" == "1" ]]; then
  if [[ -z "$DUMP" ]]; then
    echo "  drill skipped: no dump produced" >&2
  else
    echo "  restore drill: ephemeral postgres…"
    # The drill MUST use the same image as prod: a pg16 pg_restore cannot read
    # a dump produced by pg_dump 18 ("unsupported version in file header") —
    # exactly the failure a drill exists to catch.
    DRILL_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$PG_CID" 2>/dev/null || echo pgvector/pgvector:pg16)"
    DRILL_CID="$(docker run --rm -d -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill "$DRILL_IMAGE")"
    trap '[[ -n "${DRILL_CID:-}" ]] && docker rm -f "$DRILL_CID" > /dev/null 2>&1 || true' EXIT
    # Postgres images init in two phases (temp server → shutdown → real start);
    # a single pg_isready can hit the temp one. Require two OKs 2s apart.
    ok=0
    for _ in $(seq 1 45); do
      if docker exec "$DRILL_CID" pg_isready -U drill > /dev/null 2>&1; then
        ok=$((ok + 1))
        [[ $ok -ge 2 ]] && break
        sleep 2
      else
        ok=0
        sleep 1
      fi
    done
    docker exec -i "$DRILL_CID" pg_restore -U drill -d drill --no-owner --no-privileges < "$DUMP" > /dev/null 2>&1 || true
    TABLES="$(docker exec "$DRILL_CID" psql -U drill -d drill -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
    NOTES="$(docker exec "$DRILL_CID" psql -U drill -d drill -tAc "SELECT count(*) FROM memory_notes" 2>/dev/null || echo "n/a")"
    docker rm -f "$DRILL_CID" > /dev/null 2>&1; DRILL_CID=""
    if [[ "${TABLES:-0}" -ge 5 ]]; then
      echo "  restore drill OK: $TABLES tables, memory_notes=$NOTES"
    else
      echo "  WARN restore drill: only ${TABLES:-0} tables restored" >&2
    fi
  fi
fi

# Retention: keep the newest $KEEP irida-* backups.
if [[ -d "$BACKUP_BASE" ]]; then
  ls -1dt "$BACKUP_BASE"/irida-* 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -rf "$old"
    echo "  retention: pruned $(basename "$old")"
  done
fi

echo "backup-personal: done → $DEST"
