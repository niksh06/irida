# csagent

Local-first personal agent powered by the [Cursor SDK](https://cursor.com/docs/sdk/typescript). Hermes-inspired UX (sessions, skills, MCP, safety) without a second model/provider/tool loop — Cursor's own agent runtime executes the work.

> **Local-first** (no cloud runs yet). **Cron** · **Gateway** (webhook + Telegram) · **Browser MCP** · **Ink TUI** · **265 tests** green.

## Feature overview

| Area | What you get |
|------|----------------|
| **CLI** | `doctor`, `run`, `chat`, `sessions`, `resume`, `config`, `skills`, `store migrate` |
| **TUI** | `csagent tui` — tabs, slash cmds (`/delegate` → inject into session), overlays, `@file` |
| **Auth** | `csagent auth login` + `auth telegram login` → `.agent/credentials.json` or PG (pgcrypto) |
| **Memory** | `@memory:name`, MCP tools, `memory align-silo`, `import-md`, `memory fact …` |
| **Browser** | `csagent-browser` MCP — stealth Chromium (`browser_navigate`, `browser_snapshot`, …) |
| **Cron** | `cron tick` + jobs; TParser **daily** digest (5 topic delegates); prompt guard in doctor |
| **Gateway** | Webhook or Telegram → stable `sess_` per chat; csagent slash catalog + pairing |
| **Resilience** | SDK agent rotation in-session; auth errors surfaced clearly |
| **Safety** | Destructive prompt gate, secret redaction, BSD exit codes |

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

Both paths need **Node.js ≥ 20** and a **Cursor API key** (see [Requirements](#requirements)). Pick a store:

| | **Option 1 — SQLite** | **Option 2 — Postgres** |
|---|------------------------|---------------------------|
| Complexity | Simpler, no Docker | Docker + `CSAGENT_DATABASE_URL` |
| Data | `~/.csagent/.agent/state.sqlite` (or `./.agent/` in a clone) | Postgres on `:5435`, sessions + memory in PG |
| Best for | Local dev, TUI/CLI, small note sets | Production home, Telegram gateway, cron, 800+ KB notes |
| Dev ↔ gateway parity | Only with one `CSAGENT_HOME` and **no** PG URL | One PG — single source for TUI, gateway, cron |

Shared steps (both options):

```bash
git clone <repo-url> csagent && cd csagent
npm install
npm run build      # compile to dist/ (also runs on npm install via prepare)
npm link           # optional: global `csagent` command
```

Without `npm link`: **`npm run tui`** or **`npm run dev -- <subcommand>`** always runs from current `src/`.

Env is loaded automatically from `~/.csagent/csagent.env`, then repo `.env` (see `src/loadEnv.ts`).

---

### Option 1 — SQLite (simple)

Sessions, runs, and memory notes live in **SQLite** under `.agent/`. **Do not set** `CSAGENT_DATABASE_URL`.

#### 1a. Quick start in a repo clone

Good for hacking on the code and TUI without `~/.csagent`:

```bash
cd csagent
printf '%s' "cursor_..." | npx tsx src/cli.ts auth login --stdin
npx tsx src/cli.ts doctor
npx tsx src/cli.ts tui
```

State: `./.agent/state.sqlite`, `./.agent/credentials.json`, `./.agent/memory/*.md`.

#### 1b. Home install at `~/.csagent` (no Postgres)

Same runtime layout as launchd, but SQLite-only store:

```bash
cd csagent
bash deploy/setup-home.sh
# Ensure ~/.csagent/csagent.env has NO CSAGENT_DATABASE_URL line
# (setup-home.sh preserves an existing URL; remove the export manually for SQLite)

printf '%s' "cursor_..." | ~/.csagent/csagent/scripts/csagent-run.sh auth login --stdin
~/.csagent/csagent/scripts/csagent-run.sh doctor
~/.csagent/csagent/scripts/csagent-run.sh tui
```

Optional Telegram gateway + cron (macOS):

```bash
# TELEGRAM_BOT_TOKEN in csagent.env or: auth telegram login --stdin
cp deploy/gateway.json.example ~/.csagent/.agent/gateway.json   # edit allowedChatIds
bash ~/.csagent/csagent/deploy/install-launchd.sh
```

Verify: `launchctl list | grep csagent`, logs in `~/.csagent/logs/`.

---

### Option 2 — Postgres (full)

**Sessions, runs, and memory** in Postgres — best for **Telegram gateway + cron + large KB** with one store for all processes.

#### 2.1. Postgres in Docker

From the repo clone (default port **5435**, avoids TParser on :5433):

```bash
cd csagent
docker compose -f deploy/docker-compose.csagent-postgres.yml up -d
docker compose -f deploy/docker-compose.csagent-postgres.yml ps   # healthy
```

#### 2.2. Home + env

```bash
bash deploy/setup-home.sh
```

In `~/.csagent/csagent.env`, set (or uncomment after `setup-home`):

```bash
export CSAGENT_DATABASE_URL="postgresql://csagent:csagent@127.0.0.1:5435/csagent"
# export CSAGENT_LOG=1   # optional: chat/cron diagnostics (info→stdout, errors→stderr)
```

Re-run launchd install if services already exist — plists pick up env from `install-launchd.sh`:

```bash
printf '%s' "cursor_..." | ~/.csagent/csagent/scripts/csagent-run.sh auth login --stdin
~/.csagent/csagent/scripts/csagent-run.sh doctor   # should report postgres store
bash ~/.csagent/csagent/deploy/install-launchd.sh
```

Migrations (`deploy/postgres/migrations/*.sql`) run on first connect.

#### 2.3. Memory / knowledge base (optional)

Import a markdown KB into PG (example):

```bash
~/.csagent/csagent/scripts/csagent-run.sh memory import-md \
  --kb-root /path/to/agent_tutorial \
  --domains kafka
~/.csagent/csagent/scripts/csagent-run.sh memory list
```

Cron (TParser **daily** digest at `59 23 * * *`): copy `deploy/cron.jobs.example.json` → `~/.csagent/.agent/cron.jobs.json`, set `notify.chatId` and `cwd` to TParser. See [deploy/README.md](deploy/README.md).

#### 2.4. Postgres backup

```bash
docker compose -f deploy/docker-compose.csagent-postgres.yml exec -T csagent-postgres \
  pg_dump -U csagent -Fc csagent > ~/backups/csagent-$(date +%Y%m%d).dump
```

---

### Switching SQLite ↔ Postgres

1. Stop gateway/cron: `bash deploy/uninstall-launchd.sh` (or skip launchd).
2. **SQLite → Postgres:** start the container, add `CSAGENT_DATABASE_URL`, run `doctor`, then `csagent store migrate` (sessions/runs) and optionally `memory import-md` for notes.
3. **Postgres → SQLite:** remove or comment `CSAGENT_DATABASE_URL` in `csagent.env`, restart processes — back to `~/.csagent/.agent/state.sqlite` (empty or a leftover file).

After changing store: `bash deploy/setup-home.sh` and `install-launchd.sh` if you use launchd.

Ops guide: [deploy/README.md](deploy/README.md).

## Commands

> **Name collision:** if you have Cursor CLI installed, `cursor-agent` in your PATH is **Cursor's official agent**, not this repo. It has no `doctor` subcommand — `doctor` is treated as a prompt and the process hangs. Use **`csagent`**, **`npm run doctor`**, or **`npm run dev -- …`** below.

### Core

```bash
csagent doctor                       # key, node, cwd, config, mcp, cron/gateway files, API probe
csagent run "summarize repo"         # one-shot (Agent.prompt)
csagent chat                         # interactive multi-turn (Agent.create)
csagent tui                          # Ink TUI (recommended)
csagent sessions                     # list sess_ (newest first)
csagent sessions search <query>      # filter by id / title / cwd
csagent resume <sess_id> "follow up" # live resume or transcript replay
csagent store migrate [pg-url]       # one-shot sqlite → postgres (sessions/runs)
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
csagent memory list|show|add|search|rm|import-md …
csagent memory align-silo [--dry-run]   # merge repo/cron silos → CSAGENT_HOME memory
csagent memory fact add|query|invalidate …
csagent cron list|run <id>|tick
csagent gateway status         # launchd + log probe
csagent gateway run [--adapter webhook|telegram] [--port 18789]
```

During development: `npm run dev -- <subcommand>` (same as above).

> **Resume caveat:** local SDK agents are not reliably durable after process exit. `resume` tries live `Agent.resume` first; on failure it **replays the stored transcript** into a fresh agent. Cloud (`bc-`) agents resume natively when available.

### TUI (`csagent tui`)

- **Session tabs** — recent `sess_` in the header; **`1`–`5`**, **Tab** / **Shift+Tab**, **←**/**→** (empty composer), **Ctrl+[** / **Ctrl+]** to switch.
- **Slash commands** — `/help`, `/sessions`, `/skills`, `/memory`, `/model`, `/export`, `/tools`, `/doctor`, `/delegate <prompt>` (isolated run + **inject** into parent `sess_`), `/new`, `/resume <id>`, `/clear`, `/copy`, `/rename`, `/exit`, …
- **Overlays** — `/sessions`, `/skills`, `/memory`, `/model`, `/mcp` (Esc closes; scroll preserved).
- **Composer** — multiline, `@file` Tab-complete, `@memory:` refs.
- **Activity** — tool call banner during turns; thinking strip when model streams reasoning (Ctrl+T).

### Skills

Bundled: `memory-ops`, `browser-ops`, `obsidian-ops` (see `skills/`). Drop more under `skills/<name>.md` with frontmatter:

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

**Default (MCP-first):** do not set `memory.onStart`. The built-in MCP server `csagent-memory` is attached automatically (`memory.mcp`, default true). On any turn the agent can call `memory_search`, `memory_get`, `memory_list`, `memory_save`, `memory_fact_query`, `memory_fact_add`. Enable skill `memory-ops` in `gateway.json` for Telegram so the model queries memory before guessing. With `browser.mcp: true`, add skill `browser-ops` so gateway/cron use `browser_navigate` / `browser_snapshot` instead of guessing page content. For Obsidian vault read/write (filesystem, not Tolaria), add `obsidian-ops` and set `OBSIDIAN_VAULT_PATH` in `csagent.env`.

```json
"memory": { "mcp": true }
```

**Manual inject:** `@memory:name` in a message still works. **Advanced:** optional `memory.onStart` (1–2 short notes on first turn only) — avoid with large libraries; use MCP search instead.

### Cron (scheduled jobs)

`.agent/cron.jobs.json` (five-field cron, **local time**). Examples: `deploy/cron.jobs.example.json`.

**TParser daily digest** (`topicDelegates: true`) — five isolated `runDelegate` passes (AI/ML, AISec, InfoSec, Programming, DevOps) over a 24h window, then a synthesizer `runPrompt` → one Telegram message. Default schedule: **`59 23 * * *`** (23:59). Prompts: `deploy/prompts/tparser-daily-topic.prompt.txt`, `tparser-daily-synthesize.prompt.txt`.

```json
{
  "version": 1,
  "jobs": [
    {
      "id": "tparser-daily-digest",
      "cron": "59 23 * * *",
      "cwd": "/path/to/TParser",
      "skills": ["memory-ops", "browser-ops"],
      "memoryFactsSubject": "seen_post",
      "memoryFactsLimit": 200,
      "topicDelegates": true,
      "topicWindowHours": 24,
      "topicPromptFile": "deploy/prompts/tparser-daily-topic.prompt.txt",
      "synthesizePromptFile": "deploy/prompts/tparser-daily-synthesize.prompt.txt",
      "notify": { "chatId": "YOUR_CHAT_ID", "telegram": true }
    }
  ]
}
```

Simple inline job (no delegates):

```json
{
  "id": "nightly-summary",
  "cron": "0 9 * * *",
  "prompt": "Summarize open issues @memory:project",
  "skills": ["memory-ops"],
  "notify": { "chatId": "YOUR_CHAT_ID", "telegram": true }
}
```

```bash
csagent cron list
csagent cron run tparser-daily-digest
csagent cron tick    # launchd ai.csagent.cron-tick every 5 min, or system crontab
```

Launchd (macOS home): `bash deploy/install-launchd.sh` runs `cron tick` — no manual crontab required.

Optional `sessionId` binds to existing `sess_`. Destructive prompts denied unless `"yesIUnderstand": true`. Doctor checks **cron prompt guard** (injection patterns).

### Gateway (webhook / Telegram → chat)

`.agent/gateway.json`. Webhook secret via env; Telegram token via **`csagent auth telegram login --stdin`** (same `credentials.json`) or env.

**Webhook:**

```json
{
  "version": 1,
  "adapter": "webhook",
  "listen": { "host": "127.0.0.1", "port": 18789 },
  "webhook": { "path": "/hook", "secretEnv": "GATEWAY_WEBHOOK_SECRET" },
  "allowedChatIds": ["u1"]
}
```

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
  "telegram": { "tokenEnv": "TELEGRAM_BOT_TOKEN", "pollIntervalMs": 2000 },
  "allowedChatIds": ["YOUR_CHAT_ID"],
  "skills": ["memory-ops", "browser-ops", "obsidian-ops"]
}
```

Copy from `deploy/gateway.json.example` and set your chat id.

```bash
csagent auth telegram login --stdin   # or --from-env
csagent gateway run --adapter telegram
```

Each `chatId` → stable `sess_` (visible in `csagent sessions` / TUI). Allowlist required; unknown chats get a **pairing code** — admin in allowlist runs `/approve <code>`.

**Telegram slash commands (csagent catalog, no LLM):**

| Command | Action |
|---------|--------|
| `/help` | List commands (same as Bot menu) |
| `/new` | Fresh session for this chat |
| `/status` | Gateway + launchd status |
| `/doctor` | Short environment check |
| `/memory [q]` | List or search durable notes |
| `/sessions [q]` | Recent sessions for this chat |
| `/skills` | Skills from `gateway.json` |
| `/approve <code>` | Approve pairing for new chatId |
| `/delegate <prompt>` | Isolated subagent run; summary **injected** into this chat's `sess_` |

On gateway start, `setMyCommands` syncs this menu to Telegram (replaces stale Hermes entries). Free text → Cursor SDK agent turn.

**Launchd env:** `CSAGENT_SECRETS_KEY` (required with Postgres credentials), optional `OBSIDIAN_VAULT_PATH` for `obsidian-ops` — `install-launchd.sh` injects into gateway/cron plists from `~/.csagent/csagent.env`.

SIGINT disposes SDK agents.

### MCP servers

In `agent.config.json` — passed to every SDK call. Built-ins (when enabled): `csagent-memory`, `csagent-browser` (stealth Chromium via `puppeteer-extra`).

```json
{
  "memory": { "mcp": true },
  "browser": { "mcp": true, "profile": "default", "headless": true },
  "mcpServers": {
    "fs":  { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    "web": { "url": "https://example.com/mcp" }
  }
}
```

Browser tools: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_save_session`, `browser_load_session`, `browser_close`. Profile data: `<stateDir>/browser/`. Set `CSAGENT_CHROME_PATH` or `browser.chromePath` if Puppeteer’s bundled Chromium is not installed.

## Configuration

Project-local `agent.config.json`. **Secrets never go here.**

| Secret | Use when |
|--------|----------|
| `csagent auth login --stdin` | Cursor API key → `.agent/credentials.json` or Postgres (pgcrypto) |
| `csagent auth telegram login --stdin` | Telegram bot token (same stores) |
| `export CSAGENT_SECRETS_KEY=…` | With `CSAGENT_DATABASE_URL` — encrypt tokens in `credential_secrets` |
| `export CURSOR_API_KEY=…` / `TELEGRAM_BOT_TOKEN=…` | CI override (wins over stored secrets) |

```json
{
  "model": "composer-2.5",
  "runtime": "local",
  "skillsPath": "skills",
  "stateDir": ".agent",
  "mcpServers": {},
  "memory": { "mcp": true },
  "browser": { "mcp": false },
  "safety": { "allowCloud": false, "allowAutoPr": false }
}
```

State: SQLite at `<stateDir>/state.sqlite` by default, or Postgres when `CSAGENT_DATABASE_URL` is set. Previews redacted; no secrets stored.

**Cloud (016):** `runtime: "cloud"` + `safety.allowCloud` only gate today — **no real cloud SDK path yet**.

## Safety

- `run` / `resume` / cron: non-interactive destructive prompts **denied** (exit 77); `--yes-i-understand` overrides.
- `chat` / `tui`: interactive confirm (or `--yes-i-understand`).
- Redaction in logs and persisted store (SQLite or Postgres).

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
2. **`sess_…`** — conversation (SQLite or Postgres); survives rotation.
3. **`sdk_agent_id`** — ephemeral SDK handle; may be replaced mid-session + turn retry.

Auth errors (`ERROR_NOT_LOGGED_IN`) are **not** fixed by rotation — refresh the key.

## Develop

```bash
npm run typecheck
npm test            # 265 tests, mocked SDK
npm run accept      # MVP acceptance harness
npm run smoke       # live SDK (needs key)
```

Optional diagnostics: `CSAGENT_LOG=1` in `csagent.env` (rotation, runs → gateway.log); `CSAGENT_LOG_VERBOSE=1` for per-tool lines.

Idle sessions: `CSAGENT_AGENT_IDLE_MS` (default `1200000` = 20 min) proactively refreshes the SDK agent before the next turn; set `0` to disable.

## Architecture

Cursor SDK is the sole agent runtime (no parallel model/provider loop). Shared chat engine powers CLI, TUI, cron, and gateway.

| Module | Role |
|--------|------|
| `src/cli.ts` | command dispatch |
| `src/chatEngine.ts` | shared chat + rotation + `injectContext` |
| `src/delegateRun.ts` `src/cronTopicDigest.ts` | TUI/cron subagent delegates |
| `src/tui/` | Ink TUI |
| `src/store.ts` | SQLite or Postgres store |
| `src/memory*.ts` `src/cron*.ts` `src/gateway*.ts` | automation surfaces |
| `src/browser/` `src/mcp/browser*.ts` | stealth browser MCP |
| `src/gatewaySlash.ts` `src/gatewayPairing.ts` | Telegram slash + pairing |
| `issues/` | tracked specs (039, I-22…I-30, 040) — see `issues/README.md` |
| `src/safety.ts` `src/redact.ts` | gate + redaction |

## Support the author

If you find **csagent** useful, you can optionally support development on Boosty — entirely voluntary, no perks or obligations:

**[Donate on Boosty](https://boosty.to/niksh612/donate)**

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
| `pg` | Postgres store (optional) |
| `@modelcontextprotocol/sdk` | Built-in `csagent-memory` MCP server |
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
