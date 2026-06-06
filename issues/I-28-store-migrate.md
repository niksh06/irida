# I-28 — Store migrate sqlite→postgres

**Status:** done  
**Module:** `src/storeMigrate.ts`, `src/store_cmd.ts`, `src/cli.ts`

## Problem

No one-shot path to copy sessions/runs from sqlite to PG when adopting Postgres home.

## Solution

- `migrateSqliteToPostgres` — forces sqlite source even when `CSAGENT_DATABASE_URL` set
- CLI: `csagent store migrate [postgres-url]`

## Verify

```bash
# With sqlite at .agent/state.sqlite and PG URL:
csagent store migrate
# or: CSAGENT_DATABASE_URL=... csagent store migrate
```
