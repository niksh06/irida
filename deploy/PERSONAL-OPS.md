# Personal ops runbook (irida @ ~/.irida)

Локальный контур: **digest → Telegram → memory**. Не публичная дока — для одной машины.

## Ежедневный контур

| Что | Когда | Где |
|-----|-------|-----|
| TParser daily digest | `59 23 * * *` | `~/.irida/.agent/cron.jobs.json` → `tparser-daily-digest` |
| Reddit daily digest | `58 23` fetch · `59 23` SDK | `reddit-rss-fetch` → `reddit-digest-daily`; note `reddit-digest-YYYY-MM-DD` wing `reddit` |
| cron-tick | каждые 300s | launchd `ai.irida.cron-tick` |
| gateway | always | launchd `ai.irida.gateway` |
| session-ingest | `5 0 * * *` | builtin → episodic memory notes (Wave B) |
| cursor-mine | `15 0 * * *` | builtin → wing `cursor-ide` (all IDE transcripts; mtime refresh) |
| cursor-lesson | `0 7 * * 1` | queue builtin + SDK distill → wing `cursor-lesson` (disabled by default) |
| introspection | `0 6 * * 1` | weekly proposal note via `introspection-ops` skill |

**Wave B (memory loop):** nightly `session-ingest` → wing `episodic`; nightly `cursor-mine` → wing `cursor-ide`; weekly `cursor-lesson` (distill) + `introspection-weekly` → proposal notes. **autoRag off in prod** (MCP-first); pilot config: [autoRag pilot](#autorag-pilot). First backfill: `irida memory ingest-sessions --window-hours 168`; IDE archive: `irida memory mine-cursor --all`.

**Memory governance:** tiers (files / PG / embeddings), OKF scope, LLM wiki — [docs/MEMORY-GOVERNANCE.md](../docs/MEMORY-GOVERNANCE.md). Tech KB: [skills/kb-ops.md](../skills/kb-ops.md). Monthly: `memory audit` + checklist §7. After Wave F deploy: `memory re-wing --apply` (I-81), reload `deploy/prompts/csagent-index.md`.

После digest в Telegram приходят **два** сообщения:

1. Синтезированный digest (тело дня)
2. **Post-mortem** — `status`, `duration`, `topics N/M`
3. **QA alert** (только если run OK, но автоматический QA FAIL) — см. [DIGEST-QA.md](DIGEST-QA.md)

Проверка с телефона: `/status` — строка `cron tparser-daily-digest` с последним run.

### Digest QA (после первого ночного digest)

```bash
bash ~/.irida/irida/deploy/digest-qa.sh
```

Чеклист: [deploy/DIGEST-QA.md](DIGEST-QA.md). Команда: `irida cron qa`.

## Быстрые команды

```bash
# health pass (includes gateway-smoke I-88)
bash ~/.irida/irida/deploy/prod-check.sh

# gateway-only smoke after restart
bash ~/.irida/irida/deploy/gateway-smoke.sh

# ручной digest (smoke)
~/.irida/irida/scripts/csagent-run.sh cron run tparser-daily-digest

# Reddit digest (I-77): fetch RSS → context artifact → SDK summarize + memory_save
bash ~/.irida/irida/deploy/scripts/reddit-rss-fetch.sh | head
~/.irida/irida/scripts/csagent-run.sh cron run reddit-rss-fetch
~/.irida/irida/scripts/csagent-run.sh cron run reddit-digest-daily

# логи
tail -f ~/.irida/logs/gateway.log
tail -f ~/.irida/logs/cron-tick.log
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

Файлы: `~/.irida/.agent/cron.schedule.pending.json`, `cron.jobs.json`.

### Утренний re-check (08:00)

launchd `ai.irida.digest-qa-morning` → `cron qa --morning --alert`.

Если ночной digest не прошёл QA (или не было run) — **🌅 morning QA FAIL** в Telegram.

```bash
bash ~/.irida/irida/deploy/digest-qa-morning.sh   # ручной прогон
```

### Утренний cron health (08:05)

launchd `ai.irida.prod-check-morning` → `doctor morning-alert`.

Если `cron.jobs.json` missing/invalid — **🌅 morning cron health FAIL** в Telegram (с `fix:` из doctor).

```bash
bash ~/.irida/irida/deploy/prod-check-morning.sh   # ручной прогон
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

Tech reference KB: skill **`kb-ops`**, path `~/.irida/knowledge-space` (`git pull`). Not in Postgres — see [skills/kb-ops.md](../skills/kb-ops.md).

### Memory audit

```bash
~/.irida/irida/scripts/csagent-run.sh memory audit
~/.irida/irida/scripts/csagent-run.sh memory audit --links   # HEAD-check URLs in ops notes
```

Проверяет: notes vs `.md`, stale ops notes, `seen_post` facts, silo alignment, stub notes. Результат: `.agent/memory-audit.last.json`. Exit 70 = FAIL/WARN критичные пункты.

Включить curator: в `cron.jobs.json` убрать `"enabled": false` (или удалить поле).

## Backup

**Авто:** launchd `ai.irida.backup-weekly` — воскресенье **05:00** (после memory-curator 04:00).

Переустановка после обновления кода:

```bash
bash ~/.irida/irida/deploy/install-launchd.sh
```

**Вручную:**

```bash
bash ~/.irida/irida/deploy/backup-personal.sh
```

Создаёт `~/backups/csagent-YYYYMMDD-HHMM/`:

- Postgres dump (если docker PG запущен)
- Копия `~/.irida/.agent/*.json` (без credentials — только конфиги cron/gateway/peers)
- `cron.state.json` (last run + post-mortem)

Восстановление PG — см. [deploy/README.md](README.md#backup).

## autoRag pilot

**Prod default:** `enabled: false` (MCP-first). Profiles → `memory.preTurn`, not autoRag.

Reference: `deploy/agent.config.example.json` (conservative: `limit: 2`, `semantic: false`, `wings: ["default"]` only).

### Enable (after HITL sign-off)

1. Edit `~/.irida/irida/agent.config.json` — merge `memory.autoRag` from example; set `"enabled": true`.
2. **Do not** add wing `meta` without separate approval.
3. Optional observability: `export IRIDA_LOG=1` in `irida.env`.
4. Deploy + restart:

```bash
cd "/path/to/irida-clone"
npm test                                   # green before deploy
bash deploy/sync-to-prod.sh                # dry-run: review what changes
bash deploy/sync-to-prod.sh --apply        # mirror repo → $IRIDA_ROOT (code+docs+tests+specs)
launchctl kickstart -k gui/$(id -u)/ai.irida.gateway
```

`sync-to-prod.sh` is an **additive** rsync (replaces the old piecemeal `cp src/*`
that left the prod tree drifting). It excludes prod-owned state that the repo never
has — `.agent/` (cron jobs/state, creds, memory, proposals), `agent.config.json`
(engine + toolPolicy), `node_modules`, `Reports/` the agent writes — so a deploy
can't clobber them. Cron builtins pick up new `src/` on their next tick (tsx runs
from source); only the long-lived gateway needs the kickstart.

5. `doctor` — row `autoRag` should show `enabled · limit=2 · wings=default`.

### Rollback

Set `"enabled": false` (or remove `autoRag` block), `setup-home.sh`, restart gateway. No DB migration.

### Metrics (1–2 weeks)

| Signal | OK | Investigate |
|--------|-----|-------------|
| Gateway p50 turn duration | stable ±10% | p95 up >25% |
| Short-message context ratio | no spike in composed size | irrelevant memory quoted in replies |
| Errors | none | context overflow / rotation churn |
| Logs (`IRIDA_LOG=1`) | `hits=0–2`, sensible note names | always `hits=2` with unrelated names |

Inspect: `tail -f ~/.irida/logs/gateway.log | grep autoRag`, `/status` runs 24h row.

## После правок в Downloads

```bash
cd "/path/to/csagent-clone"
npm test && npm run build
bash deploy/setup-home.sh
~/.irida/irida/scripts/csagent-run.sh doctor          # format секретов + API probe — обязательно
bash ~/.irida/irida/deploy/install-launchd.sh
bash deploy/prod-check.sh
```

Post-mortem деплоя 2026-06-12 (битые секреты в PG, не «стирание» pgcrypto): [Reports/analysis/postmortem-deploy-secrets-2026-06-12.md](../Reports/analysis/postmortem-deploy-secrets-2026-06-12.md).

Post-mortem inbound Telegram 2026-06-17 (`allowed_updates` → только `channel_post`): [Reports/analysis/postmortem-gateway-telegram-inbound-silent-2026-06-17.md](../Reports/analysis/postmortem-gateway-telegram-inbound-silent-2026-06-17.md).

Post-mortem gateway 2026-06-18 (Postgres `:5435` down, poll alive но turns FAIL): [Reports/analysis/postmortem-gateway-postgres-down-2026-06-18.md](../Reports/analysis/postmortem-gateway-postgres-down-2026-06-18.md).

Post-mortem gateway 2026-06-18 (allowlist split-brain, test ID `99` в prod, pairing dead-end): [Reports/analysis/postmortem-gateway-allowlist-split-brain-2026-06-18.md](../Reports/analysis/postmortem-gateway-allowlist-split-brain-2026-06-18.md).

**Важно:** `setup-home.sh` синхронизирует **код**, не Postgres. Секреты в PG перезаписывает только `auth login`. **Gateway allowlist:** при `IRIDA_DATABASE_URL` + `IRIDA_SECRETS_KEY` chat ID хранятся **зашифрованными** в PG (`gateway_allowed_chats`); при первом `gateway run` мигрируют из `gateway.json`, plaintext `allowedChatIds` очищается (`allowedChatIdsStorage: pg`). Без Postgres — как раньше, только `~/.irida/.agent/gateway.json`. `doctor` — строки `gateway allowlist` + sanity.

## Когда что-то сломалось

| Симптом | Действие |
|---------|----------|
| digest не пришёл | `cron list`, `cron run tparser-daily-digest`, лог `cron-tick.error.log` |
| Reddit RSS 429 | Reddit rate-limits rapid fetches; snapshot lists `Fetch errors`; retry later or increase delay; digest still runs on partial data |
| `/status` FAIL gateway | `gateway status`, `tail gateway.error.log`, `doctor` (format секретов) |
| inbound тишина, outbound OK | `getWebhookInfo` → `allowed_updates` must include `message` (not only `channel_post`); см. [postmortem 2026-06-17](../Reports/analysis/postmortem-gateway-telegram-inbound-silent-2026-06-17.md) |
| poll alive, бот молчит, `ECONNREFUSED :5435` | Docker + Postgres: `open -a Docker`, `docker compose -f deploy/docker-compose.csagent-postgres.yml up -d`, `pg_isready -h 127.0.0.1 -p 5435`; restart gateway; см. [postmortem PG 2026-06-18](../Reports/analysis/postmortem-gateway-postgres-down-2026-06-18.md) |
| pairing / «чат не в allowlist» | `jq .allowedChatIds ~/.irida/.agent/gateway.json` (prod ≠ repo); diff с `.agent/gateway.json`; `/approve` только из allowlist-чата; см. [postmortem allowlist 2026-06-18](../Reports/analysis/postmortem-gateway-allowlist-split-brain-2026-06-18.md) |
| poll `Not Found` | битый token в PG → `auth telegram login --from-env` или `--stdin` |
| turn `ERROR_NOT_LOGGED_IN` | битый Cursor key в PG → `auth login --from-env` или `--stdin` |
| doctor format FAIL | секрет в PG мусор — пере-save через auth, не трогать `IRIDA_SECRETS_KEY` без re-encrypt |
| topics 0/5 в post-mortem | TParser cwd, API, delegate logs в cron-tick |
