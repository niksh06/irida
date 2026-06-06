#!/usr/bin/env bash
# Install csagent launchd agents (macOS). Unloads Hermes gateway if loaded (same Telegram bot).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${CSAGENT_ENV:-$HOME/.csagent/csagent.env}"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

CSAGENT_HOME="${CSAGENT_HOME:-$HOME/.csagent}"
CSAGENT_ROOT="${CSAGENT_ROOT:-$CSAGENT_HOME/csagent}"
CSAGENT_DATABASE_URL="${CSAGENT_DATABASE_URL:-}"
CSAGENT_SECRETS_KEY="${CSAGENT_SECRETS_KEY:-}"
OBSIDIAN_VAULT_PATH="${OBSIDIAN_VAULT_PATH:-}"
LOG_DIR="$CSAGENT_HOME/logs"
NODE_BIN="$(command -v node)"

if [[ ! -d "$CSAGENT_ROOT/src" ]]; then
  echo "CSAGENT_ROOT missing — run: bash $ROOT/deploy/setup-home.sh" >&2
  exit 1
fi

if [[ ! -f "$NODE_BIN" ]]; then
  echo "node not found in PATH" >&2
  exit 1
fi

mkdir -p "$LOG_DIR" "$LAUNCH_AGENTS" "$CSAGENT_HOME/.agent"
PATH_SNAPSHOT="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

render() {
  local src="$1" dst="$2"
  sed \
    -e "s|__CSAGENT_HOME__|${CSAGENT_HOME//|/\\|}|g" \
    -e "s|__CSAGENT_ROOT__|${CSAGENT_ROOT//|/\\|}|g" \
    -e "s|__CSAGENT_DATABASE_URL__|${CSAGENT_DATABASE_URL//|/\\|}|g" \
    -e "s|__CSAGENT_SECRETS_KEY__|${CSAGENT_SECRETS_KEY//|/\\|}|g" \
    -e "s|__OBSIDIAN_VAULT_PATH__|${OBSIDIAN_VAULT_PATH//|/\\|}|g" \
    -e "s|__CSAGENT_LOG_DIR__|${LOG_DIR//|/\\|}|g" \
    -e "s|__NODE_BIN__|${NODE_BIN//|/\\|}|g" \
    -e "s|__PATH_SNAPSHOT__|${PATH_SNAPSHOT//|/\\|}|g" \
    "$src" > "$dst"
}

echo "CSAGENT_HOME=$CSAGENT_HOME"
echo "CSAGENT_ROOT=$CSAGENT_ROOT"
if [[ -n "$CSAGENT_DATABASE_URL" ]]; then
  echo "CSAGENT_DATABASE_URL=set (postgres store)"
else
  echo "CSAGENT_DATABASE_URL=unset (sqlite store)"
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

for label in ai.csagent.gateway ai.csagent.cron-tick ai.csagent.backup-weekly; do
  launchctl bootout "$DOMAIN" "$LAUNCH_AGENTS/${label}.plist" 2>/dev/null || \
    launchctl unload "$LAUNCH_AGENTS/${label}.plist" 2>/dev/null || true
done

render "$ROOT/deploy/launchd/ai.csagent.gateway.plist" "$LAUNCH_AGENTS/ai.csagent.gateway.plist"
render "$ROOT/deploy/launchd/ai.csagent.cron-tick.plist" "$LAUNCH_AGENTS/ai.csagent.cron-tick.plist"
render "$ROOT/deploy/launchd/ai.csagent.backup-weekly.plist" "$LAUNCH_AGENTS/ai.csagent.backup-weekly.plist"

launchctl bootstrap "$DOMAIN" "$LAUNCH_AGENTS/ai.csagent.gateway.plist"
launchctl bootstrap "$DOMAIN" "$LAUNCH_AGENTS/ai.csagent.cron-tick.plist"
launchctl bootstrap "$DOMAIN" "$LAUNCH_AGENTS/ai.csagent.backup-weekly.plist"

echo "Loaded ai.csagent.gateway, ai.csagent.cron-tick, ai.csagent.backup-weekly"
launchctl list | grep csagent || true
echo "Logs: $LOG_DIR"
