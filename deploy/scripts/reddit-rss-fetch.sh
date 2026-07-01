#!/usr/bin/env bash
# Fetch Reddit /new.rss for configured subs (I-77). stdout → cron context artifact.
set -euo pipefail
ROOT="${IRIDA_ROOT:-${CSAGENT_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}}"
export REDDIT_RSS_WINDOW_HOURS="${REDDIT_RSS_WINDOW_HOURS:-24}"
exec "$ROOT/node_modules/.bin/tsx" "$ROOT/src/redditRssCli.ts"
