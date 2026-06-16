<!-- csagent cursor-lesson; source=cursor.old; sourceHash=111; status=proposal -->

# old

## Summary

- Smoke/fixture: archive `cursor.old` — только HTML metadata header, без transcript body.
- Партнёр `cursor.new` (mtime 2026-06-15, hash=222) в том же delta/backfill тесте.
- Delta mode: baseline в будущем → 0 candidates (old mtime 2026-06-01 < baseline).
- Backfill → old и new в очереди как missing; проверка `archiveIsDelta` vs force backfill.
- Нет user/assistant turns, кода, git, shell — проверка distill pipeline на минимальном archive.
- Ценность: meta про delta skip старых archive; hash `111` (shared с `cursor.small`).

## Decisions

| Topic | Decision |
|-------|----------|
| Source | `cursor.old`; id literal `old`, не UUID |
| Body | Только `cursor-ide mine` comment — нулевой transcript |
| mtime | `2026-06-01` — старше `cursor.new`; below future baseline в delta |
| Delta | `archiveIsDelta` false → skip при baseline > mtime |
| Backfill | `reason=missing`; `sourceHash=111`; оба archive в queue |
| Fixture | `test/cursorTranscriptDistill.test.ts` — delta + backfill smoke |

## Playbook

1. Read template + `skills/cursor-lesson-ops.md`; peer smoke: `cursor-lesson-small`, `cursor-lesson-new`.
2. Metadata-only archive — distill meta-pattern (delta/backfill rules), не operational workflow.
3. Summary: fixture role, delta skip vs backfill include, hash collision note; Decisions — baseline + mtime.
4. Не раздувать Playbook/Friction: нет technical steps в source — документировать distill guardrails.
5. Сохранить: `deploy/prompts/cursor-lesson-old-proposal.md`; verify `wc -c` ≤4096.

## Friction

- Skill: <3 user turns → обычно skip; explicit distill task заставляет писать thin lesson.
- Нулевой body — нет outcome/verification, только meta про delta fixture.
- Literal id `old` ломает convention `{uuid8hex}` в filename — нужен явный mapping.
- `hash=111` переиспользуется в `cursor.small` — не путать source при refresh/stale check.
