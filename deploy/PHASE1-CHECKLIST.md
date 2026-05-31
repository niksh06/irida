# Phase 1 — Hybrid Postgres (:5435)

Предусловие: Phase 0 стабилен (Telegram daemon, `~/.csagent`).

## Шаг 1 — Postgres поднять (infra)

- [x] Container `csagent-postgres` healthy на `:5435`

## Шаг 2 — Store abstraction (код)

- [x] `IStore` + `createStore()` → sqlite **или** postgres
- [x] SQL migrations `deploy/postgres/migrations/001_sessions_runs.sql`
- [x] `PostgresStore` + dep `pg`
- [x] Call sites переведены на `createStore` (async API)
- [ ] Smoke с `CSAGENT_DATABASE_URL` в `~/.csagent/csagent.env`

## Шаг 3 — Doctor probe

- [x] `CSAGENT_DATABASE_URL` → ping PG в doctor

## Шаг 4 — Smoke

```bash
export CSAGENT_HOME=~/.csagent
export CSAGENT_DATABASE_URL="postgresql://csagent:csagent@127.0.0.1:5435/csagent"
~/.csagent/csagent/scripts/csagent-run.sh doctor
~/.csagent/csagent/scripts/csagent-run.sh run "say hi" --session test-pg
~/.csagent/csagent/scripts/csagent-run.sh sessions list
```

- [ ] sessions/runs пишутся в PG (`psql` или `\dt`)

## Шаг 5 — Ops

- [ ] `pg_dump` backup note в deploy/README
- [ ] Без URL — fallback sqlite (вариант A не ломается)

---

## Не в Phase 1

- MemPalace MCP (Phase 2)
- MemPalace PG backend #665 (Phase 3)
- Миграция TParser :5433

См. [TASKS.md](./TASKS.md) P1-*.
