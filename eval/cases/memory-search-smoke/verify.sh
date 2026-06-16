#!/usr/bin/env bash
# Golden memory search smoke (I-78) — SQLite fixture store, no live SDK.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
exec "$ROOT/node_modules/.bin/tsx" "$(dirname "$0")/verify.ts"
