# cursor-agent

Local-first personal agent powered by the [Cursor SDK](https://cursor.com/docs/sdk/typescript). Hermes-inspired UX (sessions, skills, MCP, safety) without a second model/provider/tool loop — Cursor's own agent runtime executes the work.

> **Local-first** (no cloud runs yet). **Cron** · **Gateway** (webhook + Telegram) · **Ink TUI** · **217 tests** green.

## Feature overview

| Area | What you get |
|------|----------------|
| **CLI** | `doctor`, `run`, `chat`, `sessions`, `resume`, `config`, `skills` |
| **TUI** | `csagent tui` — tabs, slash cmds, overlays, scroll, `@file` complete |
| **Auth** | `csagent auth login` + `auth telegram login` → `.agent/credentials.json` (600) |
| **Memory** | `@memory:name` + `/memory` + `csagent memory …` |
| **Cron** | `.agent/cron.jobs.json` + `cron tick` from OS scheduler |
| **Gateway** | Webhook or Telegram → stable `sess_` per chat id |
| **Resilience** | SDK agent rotation in-session; auth errors surfaced clearly |
| **Safety** | Destructive prompt gate, secret redaction, BSD exit codes |

Full capability report: [Reports/projects/csagent-capabilities-2026-05-31.md](Reports/projects/csagent-capabilities-2026-05-31.md).

## Requirements

- Node.js **>= 20** (uses built-in `node:sqlite`, `node --test`).
- A Cursor API key — **either** save locally **or** export per shell:

```bash
# Recommended: once per project (stored in .agent/credentials.json, mode 600)
printf '%s' "cursor_..." | csagent auth login --stdin

# Or per-shell / CI override:
export CURSOR_API_KEY="cursor_..."   # Dashboard → Integrations
```

## Install

Оба варианта используют **Node.js ≥ 20** и **Cursor API key** (см. [Requirements](#requirements)). Выберите store:

| | **Вариант 1 — SQLite** | **Вариант 2 — Postgres** |
|---|------------------------|---------------------------|
| Сложность | Проще, без Docker | Docker + `CSAGENT_DATABASE_URL` |
| Данные | `~/.csagent/.agent/state.sqlite` (или `./.agent/` в клоне) | Postgres `:5435`, sessions + memory в PG |
| Когда | Локальная разработка, TUI/CLI, мало заметок | Production home, Telegram gateway, cron, KB 800+ notes |
| Паритет dev↔gateway | Только если везде один `CSAGENT_HOME` и **без** PG URL | Один PG — один источник для TUI, gateway, cron |

Общий шаг (оба варианта):

```bash
git clone <repo-url> csagent && cd csagent
npm install
npm run build      # compile to dist/ (also runs on npm install via prepare)
npm link           # optional: global `csagent` command
```

Dev без `npm link`: **`npm run tui`** или **`npm run dev -- <subcommand>`** — всегда из текущего `src/`.

Env подхватывается автоматически: `~/.csagent/csagent.env`, затем repo `.env` (см. `src/loadEnv.ts`).

---

### Вариант 1 — SQLite (упрощённый)

Сессии, runs и memory notes хранятся в **SQLite** под каталогом `.agent/`. **Не задавайте** `CSAGENT_DATABASE_URL`.

#### 1a. Быстрый старт в клоне репозитория

Подходит для правок кода и TUI без `~/.csagent`:

```bash
cd csagent
printf '%s' "cursor_..." | npx tsx src/cli.ts auth login --stdin
npx tsx src/cli.ts doctor
npx tsx src/cli.ts tui
```

Состояние: `./.agent/state.sqlite`, `./.agent/credentials.json`, `./.agent/memory/*.md`.

#### 1b. Home-установка `~/.csagent` (без Postgres)

Тот же runtime layout, что у launchd, но store — только SQLite:

```bash
cd csagent
bash deploy/setup-home.sh
# Убедитесь, что в ~/.csagent/csagent.env НЕТ строки CSAGENT_DATABASE_URL
# (setup-home.sh сохраняет уже заданный URL; для SQLite удалите export вручную)

printf '%s' "cursor_..." | ~/.csagent/csagent/scripts/csagent-run.sh auth login --stdin
~/.csagent/csagent/scripts/csagent-run.sh doctor
~/.csagent/csagent/scripts/csagent-run.sh tui
```

Опционально Telegram gateway + cron (macOS):

```bash
# TELEGRAM_BOT_TOKEN в csagent.env или: auth telegram login --stdin
cp deploy/gateway.json.example ~/.csagent/.agent/gateway.json   # правьте allowedChatIds
bash ~/.csagent/csagent/deploy/install-launchd.sh
```

Проверка: `launchctl list | grep csagent`, логи в `~/.csagent/logs/`.

---

### Вариант 2 — Postgres (полный)

**Sessions, runs и memory** в Postgres; удобно для **Telegram gateway + cron + большой KB** и одного store для всех процессов.

#### 2.1. Postgres в Docker

Из клона репозитория (порт **5435** по умолчанию, не конфликтует с TParser на :5433):

```bash
cd csagent
docker compose -f deploy/docker-compose.csagent-postgres.yml up -d
docker compose -f deploy/docker-compose.csagent-postgres.yml ps   # healthy
```

#### 2.2. Home + env

```bash
bash deploy/setup-home.sh
```

В `~/.csagent/csagent.env` задайте (или раскомментируйте после `setup-home`):

```bash
export CSAGENT_DATABASE_URL="postgresql://csagent:csagent@127.0.0.1:5435/csagent"
# export CSAGENT_LOG=1   # опционально: stderr-диагностика chat/cron
```

Переустановите launchd, если сервисы уже стояли — plist подхватывает env при `install-launchd.sh`:

```bash
printf '%s' "cursor_..." | ~/.csagent/csagent/scripts/csagent-run.sh auth login --stdin
~/.csagent/csagent/scripts/csagent-run.sh doctor   # должен показать postgres store
bash ~/.csagent/csagent/deploy/install-launchd.sh
```

Миграции (`deploy/postgres/migrations/*.sql`) применяются при первом подключении.

#### 2.3. Memory / knowledge base (опционально)

Импорт HappyIn KB в PG (пример):

```bash
~/.csagent/csagent/scripts/csagent-run.sh memory import-md \
  --kb-root /path/to/agent_tutorial \
  --domains kafka
~/.csagent/csagent/scripts/csagent-run.sh memory list
```

Cron (пример TParser digest): скопируйте `deploy/cron.jobs.example.json` → `~/.csagent/.agent/cron.jobs.json`, настройте `notify.chatId`. Подробнее: `deploy/README.md` и локально `docs/deploy/TPARSER-BIHOURLY-CRON.md`.

#### 2.4. Backup Postgres

```bash
docker exec deploy-csagent-postgres-1 pg_dump -U csagent -Fc csagent \
  > ~/backups/csagent-$(date +%Y%m%d).dump
```

---

### Переключение SQLite ↔ Postgres

1. Остановите gateway/cron: `bash deploy/uninstall-launchd.sh` (или не запускайте launchd).
2. **SQLite → Postgres:** поднимите контейнер, добавьте `CSAGENT_DATABASE_URL`, `doctor`, при необходимости `memory import-md` (данные из sqlite не мигрируются автоматически).
3. **Postgres → SQLite:** удалите/закомментируйте `CSAGENT_DATABASE_URL` в `csagent.env`, перезапустите процессы — снова `~/.csagent/.agent/state.sqlite` (пустой или старый файл, если остался).

После смены store: `bash deploy/setup-home.sh` и `install-launchd.sh` при использовании launchd.

Подробный ops-гайд: [deploy/README.md](deploy/README.md).

## Commands

> **Name collision:** if you have Cursor CLI installed, `cursor-agent` in your PATH is **Cursor's official agent**, not this repo. It has no `doctor` subcommand — `doctor` is treated as a prompt and the process hangs. Use **`csagent`**, **`npm run doctor`**, or **`npm run dev -- …`** below.

### Core

```bash
csagent doctor                       # key, node, cwd, config, mcp, cron/gateway files, API probe
csagent run "summarize repo"         # one-shot (Agent.prompt)
csagent chat                         # interactive multi-turn (Agent.create)
csagent tui                          # Ink TUI (recommended)
csagent sessions                     # list sess_ (newest first)
csagent resume <sess_id> "follow up" # live resume or transcript replay
csagent config                       # print non-secret config
csagent skills list|search <q>       # local Markdown skills
```

### Auth

```bash
csagent auth login --stdin           # save key to .agent/credentials.json
csagent auth status                  # configured? (never prints secret)
csagent auth logout                  # remove credentials file
```

### Memory, cron, gateway

```bash
csagent memory list|show|add|rm …
csagent cron list|run <id>|tick
csagent gateway run [--adapter webhook|telegram] [--port 18789]
```

During development: `npm run dev -- <subcommand>` (same as above).

> **Resume caveat:** local SDK agents are not reliably durable after process exit. `resume` tries live `Agent.resume` first; on failure it **replays the stored transcript** into a fresh agent. Cloud (`bc-`) agents resume natively when available.

### TUI (`csagent tui`)

- **Session tabs** — recent `sess_` in the header; **Ctrl+[** / **Ctrl+]** switch (empty composer).
- **Slash commands** — `/help`, `/sessions`, `/skills`, `/memory`, `/model`, `/export`, `/tools`, `/doctor`, `/new`, `/resume <id>`, …
- **Overlays** — `/sessions`, `/skills`, `/memory`, `/model`, `/mcp` (Esc closes; scroll preserved).
- **Composer** — multiline, `@file` Tab-complete, `@memory:` refs.
- **Activity** — tool call banner during turns; thinking strip when model streams reasoning (Ctrl+T).

### Skills

Drop Markdown skills under `skills/` (`skills/<name>.md` or `skills/<name>/SKILL.md`) with frontmatter:

```markdown
---
name: terse
description: answer in one word
tags: [style]
---
Always answer with exactly one lowercase word.
```

```bash
csagent run --skill terse "capital of France"
csagent chat --skill terse
```

### Workspace context (`@file` / `@dir`)

```bash
csagent run "review @file:src/cli.ts"
csagent run "what lives in @dir:src?"
```

Paths are relative to project cwd; traversal outside the workspace is blocked.

### Memory (`@memory`)

```bash
csagent memory add tparser --stdin <<'EOF'
# TParser
XSS alerts: Reports/analysis/digest_qa_*.md
EOF
```

In chat/TUI: `@memory:tparser` or `/memory`. Secrets redacted on save.

**Default (MCP-first):** do not set `memory.onStart`. The built-in MCP server `csagent-memory` is attached automatically (`memory.mcp`, default true). On any turn the agent can call `memory_search`, `memory_get`, `memory_list`, `memory_save`, `memory_fact_query`, `memory_fact_add`. Enable skill `memory-ops` in `gateway.json` for Telegram so the model queries memory before guessing.

```json
"memory": { "mcp": true }
```

**Manual inject:** `@memory:name` in a message still works. **Advanced:** optional `memory.onStart` (1–2 short notes on first turn only) — avoid with large libraries; use MCP search instead.

### Cron (scheduled jobs)

`.agent/cron.jobs.json` (five-field cron, local time):

```json
{
  "version": 1,
  "jobs": [
    {
      "id": "nightly-summary",
      "cron": "0 9 * * *",
      "prompt": "Summarize open issues @memory:project",
      "skills": ["review"],
      "yesIUnderstand": false,
      "notify": { "chatId": "u1", "webhookUrl": "http://127.0.0.1:18789/hook" }
    }
  ]
}
```

```bash
csagent cron list
csagent cron run nightly-summary
csagent cron tick    # call from system cron every minute
```

Example crontab:

```cron
*/5 * * * * cd /path/to/project && csagent cron tick >> /tmp/csagent-cron.log 2>&1
```

Optional `sessionId` binds to existing `sess_`. Destructive prompts denied unless `"yesIUnderstand": true`.

### Gateway (webhook / Telegram → chat)

`.agent/gateway.json`. Webhook secret via env; Telegram token via **`csagent auth telegram login --stdin`** (same `credentials.json`) or env.

**Webhook:**

```bash
export GATEWAY_WEBHOOK_SECRET=your-secret
csagent gateway run
curl -X POST http://127.0.0.1:18789/hook \
  -H 'Content-Type: application/json' \
  -H "X-Gateway-Secret: $GATEWAY_WEBHOOK_SECRET" \
  -d '{"chatId":"u1","text":"hello"}'
```

**Telegram** (long polling):

```json
{
  "version": 1,
  "adapter": "telegram",
  "telegram": { "tokenEnv": "TELEGRAM_BOT_TOKEN", "pollIntervalMs": 1500 },
  "allowedChatIds": ["123456789"],
  "skills": ["memory-ops"]
}
```

```bash
csagent auth telegram login --stdin   # or --from-env
csagent gateway run --adapter telegram
```

Each `chatId` → stable `sess_` (visible in `csagent sessions` / TUI). Allowlist required. SIGINT disposes SDK agents.

### MCP servers

In `agent.config.json` — passed to every SDK call:

```json
{
  "mcpServers": {
    "fs":  { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    "web": { "url": "https://example.com/mcp" }
  }
}
```

## Configuration

Project-local `agent.config.json`. **Secrets never go here.**

| Secret | Use when |
|--------|----------|
| `csagent auth login --stdin` | Cursor API key → `.agent/credentials.json` |
| `csagent auth telegram login --stdin` | Telegram bot token (same file) |
| `export CURSOR_API_KEY=…` / `TELEGRAM_BOT_TOKEN=…` | CI override (wins over file) |

```json
{
  "model": "composer-2.5",
  "runtime": "local",
  "skillsPath": "skills",
  "stateDir": ".agent",
  "mcpServers": {},
  "memory": { "mcp": true },
  "safety": { "allowCloud": false, "allowAutoPr": false }
}
```

State: `<stateDir>/state.sqlite`. Previews redacted; no secrets stored.

**Cloud (016):** `runtime: "cloud"` + `safety.allowCloud` only gate today — **no real cloud SDK path yet**.

## Safety

- `run` / `resume` / cron: non-interactive destructive prompts **denied** (exit 77); `--yes-i-understand` overrides.
- `chat` / `tui`: interactive confirm (or `--yes-i-understand`).
- Redaction in logs and SQLite.

> Destructive detection is a **regex denylist**, not a sandbox.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | ok |
| `64` | usage |
| `70` | software / run failed |
| `77` | noperm (unsafe prompt) |
| `78` | config / missing key |

`doctor`: `0` pass / `1` fail.

### Three layers (auth vs session vs SDK handle)

1. **`CURSOR_API_KEY`** — API access.
2. **`sess_…`** — conversation (SQLite); survives rotation.
3. **`sdk_agent_id`** — ephemeral SDK handle; may be replaced mid-session + turn retry.

Auth errors (`ERROR_NOT_LOGGED_IN`) are **not** fixed by rotation — refresh the key.

## Develop

```bash
npm run typecheck
npm test            # 217 tests, mocked SDK
npm run accept      # MVP acceptance harness
npm run smoke       # live SDK (needs key)
```

## Architecture

See `docs/adr/0001-cursor-sdk-agent-runtime.md`.

| Module | Role |
|--------|------|
| `src/cli.ts` | command dispatch |
| `src/chatEngine.ts` | shared chat + rotation |
| `src/tui/` | Ink TUI |
| `src/store.ts` | SQLite |
| `src/memory.ts` `src/cron*.ts` `src/gateway*.ts` | automation surfaces |
| `src/safety.ts` `src/redact.ts` | gate + redaction |

## License

**csagent** (this repository) is licensed under the [ISC License](LICENSE).

### Third-party runtime (not open source)

This project depends on [`@cursor/sdk`](https://www.npmjs.com/package/@cursor/sdk), which is **proprietary software** © Anysphere Inc. Its use is governed by [Cursor Terms of Service](https://cursor.com/terms-of-service), not by this repository's license.

- You need your own **Cursor account** and **API key** (`CURSOR_API_KEY` or `csagent auth login`).
- SDK usage is **billed** according to Cursor pricing (same pools as IDE / Cloud Agents).
- Do **not** redistribute, relicense, or bundle `@cursor/sdk` as if it were part of this project.

### Other dependencies

Direct npm dependencies with permissive licenses (MIT unless noted):

| Package | Role |
|---------|------|
| `ink`, `ink-text-input`, `react` | Terminal UI |
| `@cursor/sdk` | Agent runtime (**proprietary**, see above) |

Transitive licenses are listed in `package-lock.json` (`npm licenses` / `license-checker`).

### Trademarks and affiliation

- **csagent** is a community / personal project. It is **not** affiliated with, endorsed by, or maintained by Cursor or Anysphere.
- **Cursor** and related marks belong to their respective owners.
- UX patterns are **inspired by** [Hermes Agent](https://github.com/NousResearch/hermes-agent); this is a separate codebase, not a fork.

### Publishing checklist

Before pushing to a public repository:

1. Never commit `.agent/credentials.json`, bot tokens, or API keys.
2. Keep `LICENSE` and this section in sync with `package.json` (`"license": "ISC"`).
3. State clearly in the repo description that a **Cursor subscription / API access** is required to run the agent.

> This section is not legal advice. For commercial embedding or redistribution at scale, review Cursor ToS or consult counsel.
