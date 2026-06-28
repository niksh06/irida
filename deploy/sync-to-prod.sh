#!/bin/bash
# Durable prod deploy — mirror the repo (code + docs + tests + specs) into the
# prod copy at $IRIDA_ROOT, replacing the old piecemeal `cp src/*` that left the
# prod tree drifting (missing docs/, Reports/, issues/, stale tests → repeated
# "prod missing X" audit findings, and a clobbered cron.jobs.json).
#
# ADDITIVE (no --delete): the prod side owns runtime + agent-authored content
# the repo never has — .agent/ (cron jobs/state, creds, memory, proposals),
# agent.config.json (engine + toolPolicy), node_modules, and Reports/ the agent
# writes itself. Those are EXCLUDED so a deploy can never clobber them.
#
# Usage:
#   bash deploy/sync-to-prod.sh            # dry-run (shows what would change)
#   bash deploy/sync-to-prod.sh --apply    # actually sync
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/"
DEST="${IRIDA_ROOT:-$HOME/.irida/irida}/"

MODE="--dry-run"
[[ "${1:-}" == "--apply" ]] && MODE=""

# Never sync: VCS, deps, build output, local caches, runtime state, prod-owned config/reports.
EXCLUDES=(
  --exclude '.git/'
  --exclude 'node_modules/'
  --exclude 'dist/'
  --exclude '.agent/'              # runtime: cron jobs/state, credentials, memory, proposals
  --exclude 'logs/'
  --exclude 'agent.config.json'    # prod-owned: engine provider/auth + toolPolicy gate
  --exclude 'agent.config.json.bak*'
  --exclude '.env'
  --exclude '*.env'                # keeps *.env.example (templates) — only real .env files skip
  --exclude '.codegraph/'
  --exclude '.cbm/'
  --exclude '.DS_Store'
  --exclude '.claude/'
  --exclude '.cursor/'
  --exclude '.github/'
  --exclude 'repos/'               # dev working copies, not needed on prod
  --exclude 'desktop/'             # local electron prototype
  --exclude 'skills/agent/'        # agent-applied skills (I-98 L1) — prod-local, never from dev
)

echo "sync repo → prod   ${MODE:-APPLY}"
echo "  src:  $SRC"
echo "  dest: $DEST"
echo
# -a archive (perms/exec bits/timestamps), -i itemize changes, -h human sizes.
rsync -aih $MODE "${EXCLUDES[@]}" "$SRC" "$DEST"

# Rebuild dist on prod after an apply. The gateway and cron-tick run from src/ via
# tsx (always current), but the in-process MCP servers (memory/cron/ask) run from
# dist/ — and dist/ is EXCLUDED from the sync (prod-owned build artifact). Without
# this, dist drifts behind the synced source and the MCP servers run stale code
# (I-128: cron_list threw on a stale builtin enum baked into dist/cronJobs.js).
if [[ -z "$MODE" ]]; then
  echo
  echo "rebuilding dist on prod (tsc)…"
  if ( cd "$DEST" && npm run build ); then
    echo "dist rebuilt — MCP servers match the synced source"
  else
    echo "WARN: dist build failed — MCP servers may run stale code until rebuilt" >&2
  fi
fi

echo
[[ -n "$MODE" ]] && echo "(dry-run — re-run with --apply to sync)" || echo "synced + dist built. Restart gateway to pick up src/MCP changes: launchctl kickstart -k gui/\$(id -u)/ai.irida.gateway"
