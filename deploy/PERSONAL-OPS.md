# Personal ops runbook (csagent @ ~/.csagent)

Локальный контур: **digest → Telegram → memory**. Не публичная дока — для одной машины.

## Ежедневный контур

| Что | Когда | Где |
|-----|-------|-----|
| TParser daily digest | `59 23 * * *` | `~/.csagent/.agent/cron.jobs.json` → `tparser-daily-digest` |
| cron-tick | каждые 300s | launchd `ai.csagent.cron-tick` |
| gateway | always | launchd `ai.csagent.gateway` |

После digest в Telegram приходят **два** сообщения:

1. Синтезированный digest (тело дня)
2. **Post-mortem** — `status`, `duration`, `topics N/M`

Проверка с телефона: `/status` — строка `cron tparser-daily-digest` с последним run.

## Быстрые команды

```bash
# health pass
bash ~/.csagent/csagent/deploy/prod-check.sh

# ручной digest (smoke)
~/.csagent/csagent/scripts/csagent-run.sh cron run tparser-daily-digest

# логи
tail -f ~/.csagent/logs/gateway.log
tail -f ~/.csagent/logs/cron-tick.log
```

Telegram: `/status`, `/doctor`, `/memory`, `/sessions`.

## Weekly jobs

| Job | Schedule | Notes |
|-----|----------|-------|
| `memory-curator-weekly` | `0 4 * * 0` | memory-ops, отчёт в Telegram |
| `happyin-kb-weekly` | `0 3 * * 0` | disabled by default |

Включить curator: в `cron.jobs.json` убрать `"enabled": false` (или удалить поле).

## Backup

```bash
bash ~/.csagent/csagent/deploy/backup-personal.sh
```

Создаёт `~/backups/csagent-YYYYMMDD-HHMM/`:

- Postgres dump (если docker PG запущен)
- Копия `~/.csagent/.agent/*.json` (без credentials — только конфиги cron/gateway/peers)
- `cron.state.json` (last run + post-mortem)

Восстановление PG — см. [deploy/README.md](README.md#backup).

## После правок в Downloads

```bash
cd "/path/to/csagent-clone"
bash deploy/setup-home.sh
launchctl kickstart -k gui/$(id -u)/ai.csagent.gateway
launchctl kickstart -k gui/$(id -u)/ai.csagent.cron-tick
bash deploy/prod-check.sh
```

## Когда что-то сломалось

| Симптом | Действие |
|---------|----------|
| digest не пришёл | `cron list`, `cron run tparser-daily-digest`, лог `cron-tick.error.log` |
| `/status` FAIL gateway | `gateway status`, `tail gateway.error.log`, `auth telegram login` |
| doctor API key | `auth login --stdin` из dev credentials |
| topics 0/5 в post-mortem | TParser cwd, API, delegate logs в cron-tick |
