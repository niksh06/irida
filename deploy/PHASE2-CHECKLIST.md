# Phase 2 — csagent-memory (native, без MemPalace)

Предусловие: Phase 1 PG store работает (`CSAGENT_DATABASE_URL`).

**Политика:** MCP-first — без `memory.onStart`; агент тянет notes через tools на любом turn.

## Модель

| Сущность | Назначение | Пример |
|----------|------------|--------|
| **note** | Verbatim markdown, namespace `name` + optional `wing` | `@memory:tparser` |
| **fact** | Temporal triple (subject, predicate, object) | `seen_post:telegram:12345` |

## Шаг 1 — Store (код)

- [x] `memoryStore.ts` + migration `003_memory.sql`
- [x] Таблицы `memory_notes`, `memory_facts` в PG и `state.sqlite`
- [x] Dual-write: DB + mirror `.agent/memory/*.md` для sync `@memory:`
- [x] MCP `csagent-memory` tools (auto-attached, `memory.mcp`) — **основной путь**
- [ ] `memory.onStart` — только opt-in (1–2 короткие notes), не по умолчанию

## Шаг 2 — CLI

- [x] `csagent memory search <query>`
- [x] `csagent memory fact add|query|invalidate`
- [ ] `csagent memory import-md` — one-shot из существующих `.md`

## Шаг 3 — Cron / dedup

- [x] Hourly analytics: facts `seen_post` вместо `hourly-posts.state.json` (`memoryDedup.ts`, `memoryFactsSubject` в cron job)
- [x] Prompt helper: inject recent facts (`buildSeenPostsPromptSection` в `resolveCronPrompt`)
- [x] Пример: `deploy/cron.jobs.example.json`

## Шаг 4 — Search (later)

- [ ] PG `tsvector` / optional pgvector для semantic search
- [ ] SQLite FTS5

## Не делаем

- Внешний `mempalace` / `mempalace-mcp`
- ChromaDB / отдельный palace dir
- Wings/rooms/halls metaphor — только `wing` string на note

См. [TASKS.md](./TASKS.md) P2-*.
