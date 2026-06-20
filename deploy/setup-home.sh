#!/usr/bin/env bash
# Initialize ~/.irida (Hermes-style home): runtime state + install copy outside Downloads.
# Reads IRIDA_* env (legacy CSAGENT_* honored as fallback during migration).
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IRIDA_HOME="${IRIDA_HOME:-${CSAGENT_HOME:-$HOME/.irida}}"
IRIDA_ROOT="${IRIDA_ROOT:-${CSAGENT_ROOT:-$IRIDA_HOME/irida}}"
STATE_DIR="$IRIDA_HOME/.agent"
LOG_DIR="$IRIDA_HOME/logs"

mkdir -p "$IRIDA_HOME" "$STATE_DIR" "$LOG_DIR"

migrate_agent() {
  local src="$1"
  if [[ ! -d "$src" ]]; then
    return 0
  fi
  echo "Migrating runtime from $src → $STATE_DIR"
  # Never copy credentials.json — prod secrets live in PG or ~/.irida/.agent only.
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

should_migrate_agent() {
  local src="$SOURCE_ROOT/.agent"
  [[ -d "$src" ]] || return 1
  local src_abs state_abs
  src_abs="$(cd "$src" && pwd)"
  state_abs="$(cd "$STATE_DIR" && pwd)"
  if [[ "$src_abs" == "$state_abs" ]]; then
    echo "setup-home: skip .agent migrate (source is IRIDA_HOME/.agent)"
    return 1
  fi
  if [[ -f "$STATE_DIR/cron.jobs.json" || -f "$STATE_DIR/gateway.json" ]]; then
    echo "setup-home: skip .agent migrate (prod state already exists in $STATE_DIR)"
    return 1
  fi
  return 0
}

if should_migrate_agent; then
  migrate_agent "$SOURCE_ROOT/.agent"
fi

sync_install() {
  if [[ "$SOURCE_ROOT" == "$IRIDA_ROOT" ]]; then
    echo "IRIDA_ROOT=$IRIDA_ROOT (already home install)"
    return 0
  fi

  echo "Syncing irida code → $IRIDA_ROOT"
  mkdir -p "$IRIDA_ROOT"
  rsync -a \
    --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude dist \
    --exclude Reports \
    --exclude docs \
    --exclude repos \
    --exclude .agent \
    --exclude agent.config.json \
    "$SOURCE_ROOT/" "$IRIDA_ROOT/"

  if [[ ! -d "$IRIDA_ROOT/node_modules" ]] || [[ ! -d "$IRIDA_ROOT/node_modules/pg" ]]; then
    echo "Running npm install in $IRIDA_ROOT…"
    (cd "$IRIDA_ROOT" && npm install --no-fund --no-audit --ignore-scripts)
  fi
}

sync_install

if [[ -d "$SOURCE_ROOT/skills" ]]; then
  mkdir -p "$IRIDA_ROOT/skills"
  rsync -a "$SOURCE_ROOT/skills/" "$IRIDA_ROOT/skills/"
  echo "Synced skills/ → $IRIDA_ROOT/skills ($(find "$IRIDA_ROOT/skills" -name '*.md' | wc -l | tr -d ' ') files)"
fi

PRESERVE_DATABASE_URL=""
PRESERVE_SECRETS_KEY=""
PRESERVE_OBSIDIAN_VAULT_PATH=""
# Prefer the new irida.env; fall back to a legacy csagent.env still in the home dir.
PRESERVE_ENV=""
if [[ -f "$IRIDA_HOME/irida.env" ]]; then
  PRESERVE_ENV="$IRIDA_HOME/irida.env"
elif [[ -f "$IRIDA_HOME/csagent.env" ]]; then
  PRESERVE_ENV="$IRIDA_HOME/csagent.env"
fi
if [[ -n "$PRESERVE_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$PRESERVE_ENV"
  PRESERVE_DATABASE_URL="${IRIDA_DATABASE_URL:-${CSAGENT_DATABASE_URL:-}}"
  PRESERVE_SECRETS_KEY="${IRIDA_SECRETS_KEY:-${CSAGENT_SECRETS_KEY:-}}"
  PRESERVE_OBSIDIAN_VAULT_PATH="${OBSIDIAN_VAULT_PATH:-}"
fi

cat > "$IRIDA_HOME/irida.env" <<EOF
#!/usr/bin/env bash
# irida home (Hermes-style). Sourced by launchd install and csagent-run.sh.
export IRIDA_HOME="$IRIDA_HOME"
export IRIDA_ROOT="$IRIDA_ROOT"
# Hybrid store (Phase 1): unset = sqlite in \$IRIDA_HOME/.agent/
${PRESERVE_DATABASE_URL:+export IRIDA_DATABASE_URL="$PRESERVE_DATABASE_URL"}
${PRESERVE_SECRETS_KEY:+export IRIDA_SECRETS_KEY="$PRESERVE_SECRETS_KEY"}
${PRESERVE_OBSIDIAN_VAULT_PATH:+export OBSIDIAN_VAULT_PATH="$PRESERVE_OBSIDIAN_VAULT_PATH"}
# Optional overrides:
# export IRIDA_DATABASE_URL="postgresql://csagent:csagent@127.0.0.1:5435/csagent"
# export IRIDA_SECRETS_KEY="change-me-long-random-passphrase"  # pgcrypto for cursor/telegram tokens in PG
# export CURSOR_API_KEY=
# export ANTHROPIC_API_KEY=                                    # claude-agent engine (api-key auth)
# export CLAUDE_CODE_OAUTH_TOKEN=                              # claude-agent engine (account auth)
# export TELEGRAM_BOT_TOKEN=
# export OBSIDIAN_VAULT_PATH="/path/to/Obsidian/ForNotes"      # obsidian-ops skill
EOF
chmod 600 "$IRIDA_HOME/irida.env"

AGENT_CONFIG="$IRIDA_ROOT/agent.config.json"
if [[ ! -f "$AGENT_CONFIG" && -f "$IRIDA_ROOT/deploy/agent.config.example.json" ]]; then
  cp "$IRIDA_ROOT/deploy/agent.config.example.json" "$AGENT_CONFIG"
  echo "Created $AGENT_CONFIG (MCP-first memory, no onStart)"
fi

echo ""
echo "IRIDA_HOME=$IRIDA_HOME"
echo "IRIDA_ROOT=$IRIDA_ROOT"
echo "STATE_DIR=$STATE_DIR"
echo "LOG_DIR=$LOG_DIR"
echo ""
echo "Next: bash $IRIDA_ROOT/deploy/install-launchd.sh"
