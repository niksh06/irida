#!/usr/bin/env bash
# Remove irida launchd agents (and any legacy ai.csagent.* left from before the rename).
set -euo pipefail
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

for label in ai.irida.gateway ai.irida.cron-tick ai.irida.backup-weekly ai.irida.digest-qa-morning ai.irida.prod-check-morning \
             ai.csagent.gateway ai.csagent.cron-tick ai.csagent.backup-weekly ai.csagent.digest-qa-morning ai.csagent.prod-check-morning; do
  [[ -f "$LAUNCH_AGENTS/${label}.plist" ]] || continue
  launchctl bootout "$DOMAIN" "$LAUNCH_AGENTS/${label}.plist" 2>/dev/null || \
    launchctl unload "$LAUNCH_AGENTS/${label}.plist" 2>/dev/null || true
  rm -f "$LAUNCH_AGENTS/${label}.plist"
  echo "Removed $label"
done

pkill -f "cli.ts gateway run" 2>/dev/null || true
pkill -f "csagent-run.sh gateway" 2>/dev/null || true
