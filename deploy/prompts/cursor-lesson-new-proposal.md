<!-- csagent cursor-lesson; source=cursor.new; sourceHash=222; status=proposal -->

# new

## Summary

- Smoke/fixture: archive `cursor.new` — только HTML metadata header, без transcript body.
- Партнёр `cursor.old` (mtime 2026-06-01, hash=111) в том же delta/backfill тесте.
- Delta mode: baseline в будущем → 0 candidates; backfill → оба (old+new) в очереди как missing.
- Нет user/assistant turns, кода, git, shell — проверка distill pipeline на минимальном archive.
- Ценность: meta про delta vs backfill и literal id `new`; hash `222` (shared с `cursor.large` в queue-sort тесте).

## Decisions

| Topic | Decision |
|-------|----------|
| Source | `cursor.new`; id literal `new`, не UUID |
| Body | Только `cursor-ide mine` comment — нулевой transcript |
| mtime | `2026-06-15` — новее `cursor.old` для delta fixture |
| Delta | `archiveIsDelta` false при baseline > mtime → skip в delta mode |
| Backfill | `reason=missing` для old и new; `sourceHash=222` для new |
| Fixture | `test/cursorTranscriptDistill.test.ts` — delta + backfill smoke |

## Playbook

1. Read template + `skills/cursor-lesson-ops.md`; peer smoke: `cursor-lesson-small`, `chat-id`.
2. Metadata-only archive — distill meta-pattern (delta/backfill rules), не operational workflow.
3. Summary: fixture role, delta vs backfill, hash; Decisions — baseline + mtime mapping.
4. Не раздувать Playbook/Friction: нет technical steps в source — документировать distill guardrails.
5. Сохранить: `deploy/prompts/cursor-lesson-new-proposal.md`; verify `wc -c` ≤4096.

## Friction

- Skill: <3 user turns → обычно skip; explicit distill task заставляет писать thin lesson.
- Нулевой body — нет outcome/verification, только meta про delta fixture.
- Literal id `new` ломает convention `{uuid8hex}` в filename — нужен явный mapping.
- `hash=222` переиспользуется в другом тесте (`cursor.large`) — не путать source при refresh.
