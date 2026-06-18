#!/usr/bin/env bash
# Ensure the csagent Postgres container is up and accepting connections (I-112).
#
# The prod host (Mac mini) runs Postgres under Docker Desktop, which periodically
# dies on long uptime without a reboot. When it does, the gateway long-poll stays
# alive but every turn fails on ECONNREFUSED 127.0.0.1:5435 — a silent outage
# (postmortem 2026-06-18 PG down). This script is the idempotent self-heal:
#   docker daemon up?  → if not, start Docker Desktop and wait
#   container up?      → if not, `docker compose up -d`
#   pg_isready?        → wait until accepting, or fail
#
# Exit 0 = Postgres reachable. Non-zero = could not recover (caller should alert).
# Safe to run repeatedly (fast path exits immediately when already healthy).
set -uo pipefail

HOME_DIR="${CSAGENT_HOME:-$HOME/.csagent}"
ROOT="${CSAGENT_ROOT:-$HOME_DIR/csagent}"
COMPOSE_FILE="${CSAGENT_PG_COMPOSE:-$ROOT/deploy/docker-compose.csagent-postgres.yml}"
SERVICE="${CSAGENT_PG_SERVICE:-csagent-postgres}"
PG_PORT="${CSAGENT_POSTGRES_HOST_PORT:-5435}"
PG_USER="${CSAGENT_POSTGRES_USER:-csagent}"
PG_DB="${CSAGENT_POSTGRES_DB:-csagent}"
WAIT_SECS="${CSAGENT_PG_WAIT_SECS:-60}"

log() { echo "[ensure-postgres] $*"; }

# Locate the running container id for the service (compose-aware, name fallback).
container_id() {
  local cid=""
  if [ -f "$COMPOSE_FILE" ]; then
    cid="$(docker compose -f "$COMPOSE_FILE" ps -q "$SERVICE" 2>/dev/null | head -1)"
  fi
  [ -z "$cid" ] && cid="$(docker ps -q -f "name=$SERVICE" 2>/dev/null | head -1)"
  printf '%s' "$cid"
}

is_ready() {
  local cid; cid="$(container_id)"
  if [ -n "$cid" ] && docker exec "$cid" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    return 0
  fi
  # Fall back to host pg_isready (works even if the container name differs).
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -h 127.0.0.1 -p "$PG_PORT" -U "$PG_USER" >/dev/null 2>&1 && return 0
  fi
  return 1
}

if ! command -v docker >/dev/null 2>&1; then
  log "docker CLI not found — cannot manage Postgres"; exit 70
fi

# 1. Docker daemon up? If not, start Docker Desktop (macOS) and wait.
if ! docker info >/dev/null 2>&1; then
  log "docker daemon down — starting Docker Desktop"
  open -a Docker 2>/dev/null || true
  for _ in $(seq 1 "$WAIT_SECS"); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  if ! docker info >/dev/null 2>&1; then
    log "docker daemon still down after ${WAIT_SECS}s"; exit 1
  fi
  log "docker daemon up"
fi

# 2. Fast path — already accepting connections.
if is_ready; then
  log "postgres reachable"; exit 0
fi

# 3. Bring the container up via compose.
if [ ! -f "$COMPOSE_FILE" ]; then
  log "compose file not found: $COMPOSE_FILE"; exit 70
fi
log "postgres not ready — starting '$SERVICE' via compose"
docker compose -f "$COMPOSE_FILE" up -d "$SERVICE" 2>&1 | sed 's/^/[ensure-postgres] /' || true

# 4. Wait for readiness.
for i in $(seq 1 "$WAIT_SECS"); do
  if is_ready; then log "postgres reachable after ${i}s"; exit 0; fi
  sleep 1
done
log "postgres still not reachable after ${WAIT_SECS}s"; exit 1
