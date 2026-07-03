#!/usr/bin/env bash
# Golden memory search smoke (I-78) — SQLite fixture store, no live SDK.
# Hermetic (H-7): a DATABASE_URL in the caller's env used to flip the store
# to Postgres and fail the fixture run — scrub store env before exec.
set -euo pipefail
unset IRIDA_DATABASE_URL CSAGENT_DATABASE_URL IRIDA_SECRETS_KEY CSAGENT_SECRETS_KEY
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
exec "$ROOT/node_modules/.bin/tsx" "$(dirname "$0")/verify.ts"
