# Personal ops runbook (csagent @ ~/.csagent)

Локальный контур: **digest → Telegram → memory**. Не публичная дока — для одной машины.

## Ежедневный контур

| Что | Когда | Где |
|-----|-------|-----|
| TParser daily digest | `59 23 * * *` | `~/.csagent/.agent/cron.jobs.json` → `tparser-daily-digest` |
| cron-tick | каждые 300s | launchd `ai.csagent.cron-tick` |
| gateway | always | launchd `ai.csagent.gateway` |
| session-ingest | `5 0 * * *` | builtin → episodic memory notes (Wave B) |
| introspection | `0 6 * * 1` | weekly proposal note via `introspection-ops` skill |

**Wave B (memory loop):** nightly `session-ingest` → wing `episodic`; gateway `memory.autoRag` injects top-3 hits per turn (enable in `CSAGENT_ROOT/agent.config.json`). First backfill: `csagent memory ingest-sessions --window-hours 168`.

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

### Утренний cron health (08:05)

launchd `ai.csagent.prod-check-morning` → `doctor morning-alert`.

Если `cron.jobs.json` missing/invalid — **🌅 morning cron health FAIL** в Telegram (с `fix:` из doctor).

```bash
bash ~/.csagent/csagent/deploy/prod-check-morning.sh   # ручной прогон
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

### Memory audit

```bash
~/.csagent/csagent/scripts/csagent-run.sh memory audit
~/.csagent/csagent/scripts/csagent-run.sh memory audit --links   # HEAD-check URLs in ops notes
```

Проверяет: notes vs `.md`, stale ops notes, `seen_post` facts, silo alignment, stub notes. Результат: `.agent/memory-audit.last.json`. Exit 70 = FAIL/WARN критичные пункты.

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
npm test && npm run build
bash deploy/setup-home.sh
~/.csagent/csagent/scripts/csagent-run.sh doctor          # format секретов + API probe — обязательно
bash ~/.csagent/csagent/deploy/install-launchd.sh
bash deploy/prod-check.sh
```

Post-mortem деплоя 2026-06-12 (битые секреты в PG, не «стирание» pgcrypto): [Reports/analysis/postmortem-deploy-secrets-2026-06-12.md](../Reports/analysis/postmortem-deploy-secrets-2026-06-12.md).

**Важно:** `setup-home.sh` синхронизирует **код**, не Postgres. Секреты в PG перезаписывает только `auth login`. `doctor` должен показывать `CURSOR_API_KEY format: ok` и `TELEGRAM_BOT_TOKEN format: ok` (длина ~69 и ~46) **до** restart launchd.

## Когда что-то сломалось

| Симптом | Действие |
|---------|----------|
| digest не пришёл | `cron list`, `cron run tparser-daily-digest`, лог `cron-tick.error.log` |
| `/status` FAIL gateway | `gateway status`, `tail gateway.error.log`, `doctor` (format секретов) |
| poll `Not Found` | битый token в PG → `auth telegram login --from-env` или `--stdin` |
| turn `ERROR_NOT_LOGGED_IN` | битый Cursor key в PG → `auth login --from-env` или `--stdin` |
| doctor format FAIL | секрет в PG мусор — пере-save через auth, не трогать `CSAGENT_SECRETS_KEY` без re-encrypt |
| topics 0/5 в post-mortem | TParser cwd, API, delegate logs в cron-tick |
