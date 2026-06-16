<!-- csagent cursor-lesson; source=cursor.test; status=proposal -->
# Cursor chat

## Summary

- Smoke/fixture: archive note `cursor.test` (wing `cursor-ide`) с body-фразой «gateway cron long transcript archive».
- Проверяет search policy: default FTS/semantic **исключает** `cursor-ide`; ops-заметки в `default` wing остаются в выдаче.
- Gateway/cron **не** вызывают `memory search` сами — только SDK job prompt или MCP tool; CLI — ручной forensic lookup.
- Forensic доступ к длинным mined transcript: `--include-archive` (CLI) или MCP `includeArchive: true`.
- Distilled `cursor-lesson` попадает в default search; raw archive — только с явным opt-in.

## Decisions

| Topic | Decision |
|-------|----------|
| Source | `cursor.test`; id literal `test`, не UUID |
| Archive wing | `cursor-ide` в `MEMORY_ARCHIVE_WINGS`; excluded via `memorySearchPolicy.ts` |
| Default search | `csagent memory search "gateway cron"` → `ops-gateway`, не `cursor.test` |
| Forensic | `... --include-archive` или MCP `includeArchive: true` → archive hits |
| Gateway/cron | Нет auto-RAG по умолчанию; memory layers on-demand (MCP-first, I-55) |
| Fixture | `test/memorySearchPolicy.test.ts` — exclusion + `effectiveSearchExcludeWings` |

## Playbook

1. Read template + `skills/cursor-lesson-ops.md`; peer smoke: `cursor-lesson-small`, `cursor-lesson-chat`.
2. Thin archive body (одна фраза) — distill **policy pattern**, не operational cron workflow.
3. Summary: gateway vs archive scope, default vs forensic search, lesson vs archive wings.
4. Decisions: wing exclusion table + CLI/MCP flags; Playbook — guardrails для thin fixture distill.
5. Сохранить: `deploy/prompts/cursor-lesson-test-proposal.md`; verify `wc -c` ≤4096.

## Friction

- Skill: <3 user turns → обычно skip; explicit distill task заставляет писать thin lesson.
- Одна search-фраза в body — нет реального transcript/outcome, только policy smoke.
- Literal id `test` ломает convention `{uuid8hex}` в filename — нужен явный mapping.
- Легко перепутать: gateway cron **не** ищет archive; агент должен явно запросить `includeArchive`.
