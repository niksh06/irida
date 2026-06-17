#!/usr/bin/env bash
# cursor-lesson paired eval scaffold (I-79) — promote list + tasks.json, no live SDK.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
exec "$ROOT/node_modules/.bin/tsx" "$(dirname "$0")/verify.ts"
