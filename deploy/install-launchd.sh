#!/usr/bin/env bash
# Install irida launchd agents (macOS). Unloads Hermes gateway if loaded (same Telegram bot).
# Reads IRIDA_* env (legacy CSAGENT_* honored as fallback). Boots out any pre-rename
# ai.csagent.* agents so a reinstall never leaves duplicate services behind.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${IRIDA_ENV:-${CSAGENT_ENV:-$HOME/.irida/irida.env}}"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

IRIDA_HOME="${IRIDA_HOME:-${CSAGENT_HOME:-$HOME/.irida}}"
IRIDA_ROOT="${IRIDA_ROOT:-${CSAGENT_ROOT:-$IRIDA_HOME/irida}}"
IRIDA_DATABASE_URL="${IRIDA_DATABASE_URL:-${CSAGENT_DATABASE_URL:-}}"
IRIDA_SECRETS_KEY="${IRIDA_SECRETS_KEY:-${CSAGENT_SECRETS_KEY:-}}"
OBSIDIAN_VAULT_PATH="${OBSIDIAN_VAULT_PATH:-}"
LOG_DIR="$IRIDA_HOME/logs"
NODE_BIN="$(command -v node)"

if [[ ! -d "$IRIDA_ROOT/src" ]]; then
  echo "IRIDA_ROOT missing — run: bash $ROOT/deploy/setup-home.sh" >&2
  exit 1
fi

if [[ ! -f "$NODE_BIN" ]]; then
  echo "node not found in PATH" >&2
  exit 1
fi

mkdir -p "$LOG_DIR" "$LAUNCH_AGENTS" "$IRIDA_HOME/.agent"
PATH_SNAPSHOT="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

render() {
  local src="$1" dst="$2"
  sed \
    -e "s|__IRIDA_HOME__|${IRIDA_HOME//|/\\|}|g" \
    -e "s|__IRIDA_ROOT__|${IRIDA_ROOT//|/\\|}|g" \
    -e "s|__IRIDA_DATABASE_URL__|${IRIDA_DATABASE_URL//|/\\|}|g" \
    -e "s|__IRIDA_SECRETS_KEY__|${IRIDA_SECRETS_KEY//|/\\|}|g" \
    -e "s|__OBSIDIAN_VAULT_PATH__|${OBSIDIAN_VAULT_PATH//|/\\|}|g" \
    -e "s|__IRIDA_LOG_DIR__|${LOG_DIR//|/\\|}|g" \
    -e "s|__NODE_BIN__|${NODE_BIN//|/\\|}|g" \
    -e "s|__PATH_SNAPSHOT__|${PATH_SNAPSHOT//|/\\|}|g" \
    "$src" > "$dst"
}

echo "IRIDA_HOME=$IRIDA_HOME"
echo "IRIDA_ROOT=$IRIDA_ROOT"
if [[ -n "$IRIDA_DATABASE_URL" ]]; then
  echo "IRIDA_DATABASE_URL=set (postgres store)"
else
  echo "IRIDA_DATABASE_URL=unset (sqlite store)"
fi
echo "LOG_DIR=$LOG_DIR"
echo "NODE=$NODE_BIN"

if launchctl list 2>/dev/null | grep -q "ai.hermes.gateway"; then
  echo "Unloading ai.hermes.gateway (Telegram bot conflict)…"
  launchctl bootout "$DOMAIN" "$HOME/Library/LaunchAgents/ai.hermes.gateway.plist" 2>/dev/null || \
    launchctl unload "$HOME/Library/LaunchAgents/ai.hermes.gateway.plist" 2>/dev/null || true
fi

pkill -f "cli.ts gateway run" 2>/dev/null || true
pkill -f "csagent-run.sh gateway" 2>/dev/null || true
sleep 1

# Boot out current irida agents AND any legacy ai.csagent.* (pre-rename) to avoid duplicates.
for label in ai.irida.gateway ai.irida.cron-tick ai.irida.backup-weekly ai.irida.digest-qa-morning ai.irida.prod-check-morning \
             ai.csagent.gateway ai.csagent.cron-tick ai.csagent.backup-weekly ai.csagent.digest-qa-morning ai.csagent.prod-check-morning; do
  launchctl bootout "$DOMAIN" "$LAUNCH_AGENTS/${label}.plist" 2>/dev/null || \
    launchctl unload "$LAUNCH_AGENTS/${label}.plist" 2>/dev/null || true
done

render "$ROOT/deploy/launchd/ai.irida.gateway.plist" "$LAUNCH_AGENTS/ai.irida.gateway.plist"
render "$ROOT/deploy/launchd/ai.irida.cron-tick.plist" "$LAUNCH_AGENTS/ai.irida.cron-tick.plist"
render "$ROOT/deploy/launchd/ai.irida.backup-weekly.plist" "$LAUNCH_AGENTS/ai.irida.backup-weekly.plist"
render "$ROOT/deploy/launchd/ai.irida.digest-qa-morning.plist" "$LAUNCH_AGENTS/ai.irida.digest-qa-morning.plist"
render "$ROOT/deploy/launchd/ai.irida.prod-check-morning.plist" "$LAUNCH_AGENTS/ai.irida.prod-check-morning.plist"

launchctl bootstrap "$DOMAIN" "$LAUNCH_AGENTS/ai.irida.gateway.plist"
launchctl bootstrap "$DOMAIN" "$LAUNCH_AGENTS/ai.irida.cron-tick.plist"
launchctl bootstrap "$DOMAIN" "$LAUNCH_AGENTS/ai.irida.backup-weekly.plist"
launchctl bootstrap "$DOMAIN" "$LAUNCH_AGENTS/ai.irida.digest-qa-morning.plist"
launchctl bootstrap "$DOMAIN" "$LAUNCH_AGENTS/ai.irida.prod-check-morning.plist"

echo "Loaded ai.irida.gateway, ai.irida.cron-tick, ai.irida.backup-weekly, ai.irida.digest-qa-morning, ai.irida.prod-check-morning"
launchctl list | grep irida || true
echo "Logs: $LOG_DIR"
