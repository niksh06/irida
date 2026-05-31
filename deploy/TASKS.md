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
| P1-6 | PG smoke + optional env in csagent.env | done |

## Phase 2 — csagent-memory (native)

| ID | Task | Status |
|----|------|--------|
| P2-1 | `memoryStore.ts` — notes + facts in sqlite/PG | done |
| P2-2 | Migration `003_memory.sql` | done |
| P2-3 | CLI: search, fact add/query/invalidate | done |
| P2-4 | Dual-write DB + `.agent/memory/*.md` for @memory | done |
| P2-5 | MCP csagent-memory tools (memory_get/search/save/facts) | done |
| P2-6 | Cron: facts instead of JSON state (hourly dedup) | done |
| P2-7 | FTS / pgvector search (optional) | todo |
| P2-8 | Unified memory root — [039](./issues/039-unified-memory-root.md); ops [MEMORY-DEV-ALIGNMENT.md](./MEMORY-DEV-ALIGNMENT.md) | todo |
| P2-9 | TParser bi-hourly digest cron + Telegram notify — [TPARSER-BIHOURLY-CRON.md](./TPARSER-BIHOURLY-CRON.md) | done (code); runtime smoke pending |

## Phase 3 — Unified PG schema

| ID | Task | Status |
|----|------|--------|
| P3-1 | pgcrypto for sensitive facts/notes | todo |
| P3-2 | Optional: ingest session runs as searchable notes | todo |
| P3-3 | Optional: mine Cursor JSONL convos | todo |
