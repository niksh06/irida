#!/usr/bin/env bash
# Initialize ~/.csagent (Hermes-style home): runtime state + install copy outside Downloads.
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CSAGENT_HOME="${CSAGENT_HOME:-$HOME/.csagent}"
CSAGENT_ROOT="${CSAGENT_ROOT:-$CSAGENT_HOME/csagent}"
STATE_DIR="$CSAGENT_HOME/.agent"
LOG_DIR="$CSAGENT_HOME/logs"

mkdir -p "$CSAGENT_HOME" "$STATE_DIR" "$LOG_DIR"

migrate_agent() {
  local src="$1"
  if [[ ! -d "$src" ]]; then
    return 0
  fi
  echo "Migrating runtime from $src → $STATE_DIR"
  # Never copy credentials.json — prod secrets live in PG or ~/.csagent/.agent only.
  for f in gateway.json gateway.peers.json cron.jobs.json cron.state.json state.sqlite; do
    if [[ -f "$src/$f" && ! -f "$STATE_DIR/$f" ]]; then
      cp -p "$src/$f" "$STATE_DIR/"
      echo "  copied $f"
    fi
  done
  if [[ -d "$src/memory" && ! -d "$STATE_DIR/memory" ]]; then
    cp -a "$src/memory" "$STATE_DIR/"
    echo "  copied memory/"
  fi
}

migrate_agent "$SOURCE_ROOT/.agent"

sync_install() {
  if [[ "$SOURCE_ROOT" == "$CSAGENT_ROOT" ]]; then
    echo "CSAGENT_ROOT=$CSAGENT_ROOT (already home install)"
    return 0
  fi

  echo "Syncing csagent code → $CSAGENT_ROOT"
  mkdir -p "$CSAGENT_ROOT"
  rsync -a \
    --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude dist \
    --exclude Reports \
    --exclude docs \
    --exclude repos \
    --exclude .agent \
    "$SOURCE_ROOT/" "$CSAGENT_ROOT/"

  if [[ ! -d "$CSAGENT_ROOT/node_modules" ]] || [[ ! -d "$CSAGENT_ROOT/node_modules/pg" ]]; then
    echo "Running npm install in $CSAGENT_ROOT…"
    (cd "$CSAGENT_ROOT" && npm install --no-fund --no-audit --ignore-scripts)
  fi
}

sync_install

if [[ -d "$SOURCE_ROOT/skills" ]]; then
  mkdir -p "$CSAGENT_ROOT/skills"
  rsync -a "$SOURCE_ROOT/skills/" "$CSAGENT_ROOT/skills/"
  echo "Synced skills/ → $CSAGENT_ROOT/skills ($(find "$CSAGENT_ROOT/skills" -name '*.md' | wc -l | tr -d ' ') files)"
fi

PRESERVE_DATABASE_URL=""
PRESERVE_SECRETS_KEY=""
PRESERVE_OBSIDIAN_VAULT_PATH=""
if [[ -f "$CSAGENT_HOME/csagent.env" ]]; then
  # shellcheck disable=SC1090
  source "$CSAGENT_HOME/csagent.env"
  PRESERVE_DATABASE_URL="${CSAGENT_DATABASE_URL:-}"
  PRESERVE_SECRETS_KEY="${CSAGENT_SECRETS_KEY:-}"
  PRESERVE_OBSIDIAN_VAULT_PATH="${OBSIDIAN_VAULT_PATH:-}"
fi

cat > "$CSAGENT_HOME/csagent.env" <<EOF
#!/usr/bin/env bash
# csagent home (Hermes-style). Sourced by launchd install and csagent-run.sh.
export CSAGENT_HOME="$CSAGENT_HOME"
export CSAGENT_ROOT="$CSAGENT_ROOT"
# Hybrid store (Phase 1): unset = sqlite in \$CSAGENT_HOME/.agent/
${PRESERVE_DATABASE_URL:+export CSAGENT_DATABASE_URL="$PRESERVE_DATABASE_URL"}
${PRESERVE_SECRETS_KEY:+export CSAGENT_SECRETS_KEY="$PRESERVE_SECRETS_KEY"}
${PRESERVE_OBSIDIAN_VAULT_PATH:+export OBSIDIAN_VAULT_PATH="$PRESERVE_OBSIDIAN_VAULT_PATH"}
# Optional overrides:
# export CSAGENT_DATABASE_URL="postgresql://csagent:csagent@127.0.0.1:5435/csagent"
# export CSAGENT_SECRETS_KEY="change-me-long-random-passphrase"  # pgcrypto for cursor/telegram tokens in PG
# export CURSOR_API_KEY=
# export TELEGRAM_BOT_TOKEN=
# export OBSIDIAN_VAULT_PATH="/path/to/Obsidian/ForNotes"  # obsidian-ops skill
EOF
chmod 644 "$CSAGENT_HOME/csagent.env"

AGENT_CONFIG="$CSAGENT_ROOT/agent.config.json"
if [[ ! -f "$AGENT_CONFIG" && -f "$CSAGENT_ROOT/deploy/agent.config.example.json" ]]; then
  cp "$CSAGENT_ROOT/deploy/agent.config.example.json" "$AGENT_CONFIG"
  echo "Created $AGENT_CONFIG (MCP-first memory, no onStart)"
fi

echo ""
echo "CSAGENT_HOME=$CSAGENT_HOME"
echo "CSAGENT_ROOT=$CSAGENT_ROOT"
echo "STATE_DIR=$STATE_DIR"
echo "LOG_DIR=$LOG_DIR"
echo ""
echo "Next: bash $CSAGENT_ROOT/deploy/install-launchd.sh"
