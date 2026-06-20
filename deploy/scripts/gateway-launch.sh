#!/usr/bin/env bash
# launchd entrypoint for the gateway (I-112): ensure Postgres is up, then exec
# the long-poll. After a reboot or a Docker Desktop crash, the store may not be
# ready when launchd (re)starts the gateway; without this the poll runs but every
# turn fails on ECONNREFUSED. ensure-postgres self-heals before we hand off.
#
# Wired via deploy/launchd/ai.irida.gateway.plist ProgramArguments. Passes any
# extra args (e.g. --adapter telegram) straight through to `gateway run`.
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${IRIDA_ROOT:-${CSAGENT_ROOT:?IRIDA_ROOT or CSAGENT_ROOT must be set}}"

# Best effort: never block gateway start indefinitely on a store problem — the
# gateway's own status/turn handling now surfaces a down store (I-108/I-109).
bash "$DIR/ensure-postgres.sh" || echo "[gateway-launch] ensure-postgres failed — starting gateway anyway" >&2

TSX="$ROOT/node_modules/.bin/tsx"
exec node "$TSX" "$ROOT/src/cli.ts" gateway run "$@"
