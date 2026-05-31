# csagent deployment tasks

Source plan: `Reports/projects/csagent-deployment-mempalace-2026-05-31.md`  
Phase 0 checklist: [PHASE0-CHECKLIST.md](./PHASE0-CHECKLIST.md)

## Phase 0 — Variant A hardened

| ID | Task | Status |
|----|------|--------|
| P0-1 | `scripts/csagent-run.sh` — tsx launcher, `CSAGENT_HOME` | done |
| P0-2 | `scripts/csagent.mjs` — tsx fallback on build EACCES | done |
| P0-3 | `deploy/setup-home.sh` — `~/.csagent` home | done |
| P0-4 | `deploy/launchd/*.plist` + install/uninstall | done |
| P0-5 | `deploy/README.md` — ops, Hermes switch | done |
| P0-6 | Telegram typing indicator | done |
| P0-7 | Tool progress (opt-in, default off) | done |
| P0-8 | doctor + launchd + gateway running | done |
| P0-9 | Telegram smoke + reboot-test | in progress (reboot/overflow later) |
| P0-10 | 2-week stability → Phase 0 closed | pending |

## Phase 1 — Hybrid PG (:5435)

| ID | Task | Status |
|----|------|--------|
| P1-1 | `deploy/docker-compose.csagent-postgres.yml` | done (scaffold) |
| P1-2 | Postgres Dockerfile (pgvector + pgcrypto) | done (scaffold) |
| P1-3 | Store abstraction `sqlite \| postgres` | done |
| P1-4 | SQL migrations: sessions, runs | done |
| P1-5 | `CSAGENT_DATABASE_URL` in doctor | done |
| P1-6 | PG smoke + optional env in csagent.env | **→ user** |

## Phase 2 — MemPalace MCP

| ID | Task | Status |
|----|------|--------|
| P2-1 | `uv tool install mempalace` on host | todo |
| P2-2 | `mempalace init` → `~/.csagent/.mempalace/` | todo |
| P2-3 | Wings/rooms: csagent-ops, telegram, analytics | todo |
| P2-4 | `agent.config.json` mcpServers.mempalace | todo |
| P2-5 | Cron prompt → KG instead of JSON state | todo |

## Phase 3 — Unified PG schema

| ID | Task | Status |
|----|------|--------|
| P3-1 | MemPalace drawers/facts schema on :5435 | todo |
| P3-2 | pgcrypto for sensitive drawers | todo |
| P3-3 | Optional: mine Cursor JSONL convos | todo |
