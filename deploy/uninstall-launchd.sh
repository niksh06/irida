#!/usr/bin/env bash
set -euo pipefail
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

for label in ai.csagent.gateway ai.csagent.cron-tick ai.csagent.backup-weekly ai.csagent.digest-qa-morning ai.csagent.prod-check-morning; do
  launchctl bootout "$DOMAIN" "$LAUNCH_AGENTS/${label}.plist" 2>/dev/null || \
    launchctl unload "$LAUNCH_AGENTS/${label}.plist" 2>/dev/null || true
  rm -f "$LAUNCH_AGENTS/${label}.plist"
  echo "Removed $label"
done

pkill -f "cli.ts gateway run" 2>/dev/null || true
pkill -f "csagent-run.sh gateway" 2>/dev/null || true
