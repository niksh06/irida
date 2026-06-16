<!-- csagent cursor-lesson; source=cursor.small; sourceHash=111; status=proposal -->

# small

## Summary

- Smoke/fixture: archive note `cursor.small` содержит только HTML metadata header — без transcript body.
- Источник для `listTranscriptsNeedingDistill`: missing lesson → candidate; peer `cursor.large` уже distilled.
- Очередь сортирует по `bodyBytes` desc — small всплывает как единственный stale/missing при limit.
- Нет user/assistant turns, кода, git, shell, MCP — проверка distill pipeline на минимальном archive.
- Ценность meta: как сжимать metadata-only source без раздувания playbook; hash `111`.

## Decisions

| Topic | Decision |
|-------|----------|
| Source | `cursor.small`; id literal `small`, не UUID |
| Body | Только `cursor-ide mine` comment — нулевой transcript |
| Queue | `reason=missing` когда `lesson.small` отсутствует; `sourceHash=111` |
| Sort | `bodyBytes` desc — large (5k+) ниже приоритет если lesson fresh |
| Fixture | `test/cursorTranscriptDistill.test.ts` — distill queue smoke |

## Playbook

1. Read template + `skills/cursor-lesson-ops.md`; peer smoke: `cursor-lesson-chat`, `21376eee`.
2. Metadata-only archive — distill meta-pattern (queue/skip rules), не operational workflow.
3. Summary: 3–5 bullets (fixture role, queue behavior, hash); Decisions — mapping + sort rules.
4. Не раздувать Playbook/Friction: нет technical steps в source — документировать distill guardrails.
5. Сохранить: `deploy/prompts/cursor-lesson-small-proposal.md`; verify `wc -c` ≤4096.

## Friction

- Skill: <3 user turns → обычно skip; explicit distill task заставляет писать thin lesson.
- Нулевой body — нет outcome/verification, только meta про queue fixture.
- Literal id `small` ломает convention `{uuid8hex}` в filename — нужен явный mapping.
- `hash=111` — короткий test value, не 16-char hex как у реальных mines.
