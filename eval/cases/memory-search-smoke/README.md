# memory-search-smoke (I-78)

Golden queries for default memory search (I-62 exclude + I-73 episodic exclude).

## Run

```bash
npm run eval
# or
npx tsx src/cli.ts eval run memory-search-smoke
```

## Add a case

1. Add fixture note(s) to `queries.json` → `fixtures` (include a `cursor-ide` decoy if the query is ambiguous).
2. Append to `cases`: `query`, `expectTop1` (note name), optional `mustNotWings` (default `["cursor-ide"]`).
3. Run `npm run eval` — no LLM judge; fails if top-1 wrong or forbidden wing appears in top-N (`topN`, default 5).

Prod spot-check (optional): same queries against `IRIDA_DATABASE_URL` with `irida memory search`.
