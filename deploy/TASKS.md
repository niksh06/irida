# csagent deployment tasks

Source plan: `Reports/projects/csagent-deployment-mempalace-2026-05-31.md`

## Phase 0 — Variant A hardened (current)

| ID | Task | Status |
|----|------|--------|
| P0-1 | `scripts/csagent-run.sh` — tsx launcher, `CSAGENT_HOME` | done |
| P0-2 | `scripts/csagent.mjs` — tsx fallback on build EACCES | done |
| P0-3 | `deploy/launchd/ai.csagent.gateway.plist` | done |
| P0-4 | `deploy/launchd/ai.csagent.cron-tick.plist` | done |
| P0-5 | `deploy/install-launchd.sh` + `deploy/uninstall-launchd.sh` | done |
| P0-6 | `deploy/README.md` — Hermes switch, ops | done |
| P0-7 | Load daemons, verify doctor + gateway | pending (user) |

## Phase 1 — Hybrid PG (:5435)

| ID | Task | Status |
|----|------|--------|
| P1-1 | `deploy/docker-compose.csagent-postgres.yml` | done |
| P1-2 | Postgres Dockerfile (pgvector + pgcrypto) | done |
| P1-3 | Store abstraction `sqlite \| postgres` | todo |
| P1-4 | SQL migrations: sessions, runs, cron, gateway | todo |
| P1-5 | `CSAGENT_DATABASE_URL` in doctor | todo |

## Phase 2 — MemPalace MCP

| ID | Task | Status |
|----|------|--------|
| P2-1 | `uv tool install mempalace` on host | todo |
| P2-2 | `mempalace init` → `TParser/.mempalace/` | todo |
| P2-3 | Wings/rooms: tparser, telegram-ops, hourly-analytics | todo |
| P2-4 | `TParser/agent.config.json` mcpServers.mempalace | todo |
| P2-5 | Cron prompt → KG instead of JSON state | todo |

## Phase 3 — Unified PG schema

| ID | Task | Status |
|----|------|--------|
| P3-1 | MemPalace drawers/facts schema on :5435 | todo |
| P3-2 | pgcrypto for sensitive drawers | todo |
| P3-3 | Optional: mine Cursor JSONL convos | todo |
