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
3. **QA alert** (только если run OK, но автоматический QA FAIL) — см. [DIGEST-QA.md](DIGEST-QA.md)

Проверка с телефона: `/status` — строка `cron tparser-daily-digest` с последним run.

### Digest QA (после первого ночного digest)

```bash
bash ~/.csagent/csagent/deploy/digest-qa.sh
```

Чеклист: [deploy/DIGEST-QA.md](DIGEST-QA.md). Команда: `csagent cron qa`.

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

Telegram: `/status`, `/doctor`, `/memory`, `/sessions`, `/schedule`.

### Cron из чата (Telegram)

**Путь 2 (основной):** напиши агенту, например «каждый понедельник в 9:00 — разбор inbox». Агент вызовет MCP `cron_propose` и вернёт код подтверждения:

```
/schedule approve ABC123
```

**Путь 1 (fallback, slash):**

```text
/schedule help
/schedule list          # все jobs
/schedule user          # только user-*
/schedule pending       # ждут approve
/schedule add 0 9 * * 1 weekly-inbox Summarize open tasks
/schedule remove user-weekly-inbox
```

User jobs: id с префиксом `user-`, max 10, notify → этот чат. Системные (`tparser-daily-digest`, …) через `/schedule remove` не удаляются.

Skill: `cron-ops` в `gateway.json` (см. `deploy/gateway.json.example`).

Файлы: `~/.csagent/.agent/cron.schedule.pending.json`, `cron.jobs.json`.

### Утренний re-check (08:00)

launchd `ai.csagent.digest-qa-morning` → `cron qa --morning --alert`.

Если ночной digest не прошёл QA (или не было run) — **🌅 morning QA FAIL** в Telegram.

```bash
bash ~/.csagent/csagent/deploy/digest-qa-morning.sh   # ручной прогон
```

### Digest follow-up (H2)

После вечернего digest в чате бота (без `/`):

- `топ-50` / `top-20` — топ постов
- `только InfoSec` / `only devops` / `только AI` — фильтр по теме

Контекст последнего digest подмешивается из `.agent/cron.last-digest.*.txt`.

## Weekly jobs

| Job | Schedule | Notes |
|-----|----------|-------|
| `memory-curator-weekly` | `0 4 * * 0` | memory-ops, отчёт в Telegram |
| `happyin-kb-weekly` | `0 3 * * 0` | disabled by default |

Включить curator: в `cron.jobs.json` убрать `"enabled": false` (или удалить поле).

## Backup

**Авто:** launchd `ai.csagent.backup-weekly` — воскресенье **05:00** (после memory-curator 04:00).

Переустановка после обновления кода:

```bash
bash ~/.csagent/csagent/deploy/install-launchd.sh
```

**Вручную:**

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
