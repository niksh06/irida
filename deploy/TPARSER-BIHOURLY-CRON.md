# TParser bi-hourly cron (defaults)

Дайджest **всех** релевантных постов за **последние 2 часа** → push в Telegram. **Без `/api/feed`.**

| Параметр | Значение |
|----------|----------|
| Job id | `tparser-bi-hourly-digest` |
| Cron | `0 */2 * * *` (12×/день) |
| cwd | `/path/to/TParser` |
| skills | `memory-ops` |
| Push | `notify.telegram: true` |
| Пустой прогон | push «новых релевантных постов нет» |
| Obsidian | только вечерний job (отдельно) |

## Defaults (зафиксировано)

- Окно: `(now − 2h, now]` по `created_at` ingest (`recent-live` + paginate).
- Фильтр: **topic_tags** (allowlist в prompt + `tparser-workflow` note).
- Полнота: все matching в окне, без top-N.
- Dedup: `seen_post` facts + повторная проверка в prompt.
- Notify: прямой `sendMessage` (не webhook → agent).

## Файлы

| Файл | Назначение |
|------|------------|
| `deploy/prompts/tparser-bi-hourly.prompt.txt` | текст prompt |
| `deploy/cron.jobs.example.json` | пример job + notify |
| `~/.csagent/.agent/cron.jobs.json` | runtime (после deploy) |

## Включение

```bash
# sync code
bash deploy/setup-home.sh && cd ~/.csagent/csagent && npm run build

# merge example → runtime (или cp целиком)
cp deploy/cron.jobs.example.json ~/.csagent/.agent/cron.jobs.json
chmod 600 ~/.csagent/.agent/cron.jobs.json

# smoke (дорого — реальный SDK run)
export CSAGENT_HOME=~/.csagent
export CSAGENT_DATABASE_URL=postgresql://csagent:csagent@127.0.0.1:5435/csagent
~/.csagent/csagent/scripts/csagent-run.sh cron run tparser-bi-hourly-digest
```

Проверь Telegram: digest или «нет постов». Лог: `~/.csagent/logs/cron-tick.log`.

## API (не feed)

1. `GET /api/posts/recent-live?limit=150` (+ `after_rowid`)
2. `GET /api/posts/by-keys?keys=...` (≤50 пар)
3. опционально `GET /api/posts/{id}/analysis?channel_id=`

## Ограничения

- Telegram `sendMessage` ≤4096 символов — длинный digest режется на несколько сообщений.
- `TELEGRAM_BOT_TOKEN` — из env или credentials (как gateway).
- TParser API `:8002` должен быть up.

См. также [MEMORY-DEV-ALIGNMENT.md](./MEMORY-DEV-ALIGNMENT.md) (memory silos).
