# Digest QA checklist

Автоматика + ручная проверка после `tparser-daily-digest`.

## Автоматически (`cron qa`)

```bash
~/.csagent/csagent/scripts/csagent-run.sh cron qa
# или
bash ~/.csagent/csagent/deploy/digest-qa.sh
```

Проверяет `cron.state.json` (`lastResult`) и сохранённое тело digest (`.agent/cron.last-digest.tparser-daily-digest.txt`).

| Check | PASS когда |
|-------|------------|
| job config | `topicDelegates` job есть в `cron.jobs.json` |
| last run | есть `lastResult` |
| run status | `ok: true` |
| freshness | последний run ≤ 26h |
| duration | 30s – 60m |
| topics | ≥ 4/5 delegates ok |
| digest header | `📬` или `TParser` (или empty-day шаблон) |
| digest length | 100–4500 chars (или короткий empty-day) |
| tg links | ≥ 1 `t.me/` (кроме empty-day) |
| topic sections | ≥ 3 заголовков тем в теле |

Exit code: `0` = PASS, `70` = FAIL.

## Post-mortem в Telegram (сразу после cron)

Второе сообщение после digest:

```
📊 [cron:tparser-daily-digest] post-mortem
status: OK
duration: 12m 5s
topics: 5/5 (ai-ml, aisec-mlsec, …)
```

**Красные флаги:** `FAILED`, `topics: 0/5`, `duration: 5s`, любой topic с `✗`.

## Ручной чеклист (1 мин в Telegram)

- [ ] Заголовок `📬 TParser · день · …`
- [ ] Сводка дня — 3–5 bullets, не вода
- [ ] У каждого поста: структура + **Вердикт агента** + строка `t.me/…` (не markdown-ссылка)
- [ ] Нет выдуманных постов (сверка с TParser при сомнении)
- [ ] Длина одного сообщения ≤ ~4000 символов
- [ ] Пустой день: `релевантных постов не было` — ок, не баг

## Если FAIL

1. `/status` — `cron tparser-daily-digest`
2. `tail -50 ~/.csagent/logs/cron-tick.error.log`
3. Ручной smoke: `cron run tparser-daily-digest`
4. Topic с `✗` — смотреть delegate в логе `[cron] topic delegate done topic=…`

См. [PERSONAL-OPS.md](PERSONAL-OPS.md).
