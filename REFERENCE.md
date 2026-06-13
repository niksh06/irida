# csagent — Reference

Full command, configuration, and architecture reference. Install and deployment live in [OPS.md](OPS.md); quickstart in [README.md](README.md).

> **Name collision:** if you have Cursor CLI installed, `cursor-agent` in your PATH is **Cursor's official agent**, not this repo. It has no `doctor` subcommand — `doctor` is treated as a prompt and the process hangs. Use **`csagent`**, **`npm run doctor`**, or **`npm run dev -- …`**.

## Commands

### Core

```bash
csagent doctor                       # key, node, cwd, config, mcp, cron/gateway files, API probe
csagent run "summarize repo"         # one-shot (Agent.prompt)
csagent chat                         # interactive multi-turn (Agent.create)
csagent tui                          # Ink TUI (recommended)
csagent sessions                     # list sess_ (newest first)
csagent sessions search <query>      # filter by id / title / cwd
csagent resume <sess_id> "follow up" # live resume or transcript replay
csagent store migrate [pg-url]       # one-shot sqlite → postgres (sessions/runs/memory)
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
csagent memory audit [--links] [--stale-days 90]  # notes/facts/silo QA
csagent memory fact add|query|invalidate …
csagent cron list|run <id>|tick|qa
csagent gateway status         # launchd + log probe + outbox + 24h run metrics
csagent gateway run [--adapter webhook|telegram] [--port 18789]
```

During development: `npm run dev -- <subcommand>` (same as above).

> **Resume caveat:** local SDK agents are not reliably durable after process exit. `resume` tries live `Agent.resume` first; on failure it **replays the stored transcript** into a fresh agent.

## TUI (`csagent tui`)

- **Session tabs** — recent `sess_` in the header; **`1`–`5`**, **Tab** / **Shift+Tab**, **←**/**→** (empty composer), **Ctrl+[** / **Ctrl+]** to switch.
- **Slash commands** — `/help`, `/sessions`, `/skills`, `/memory`, `/model`, `/export`, `/tools`, `/doctor`, `/delegate <prompt>` (isolated run + **inject** into parent `sess_`), `/find <text>` (transcript search; repeat = older match), `/new`, `/resume <id>`, `/clear`, `/copy`, `/rename`, `/exit`, …
- **Overlays** — `/sessions`, `/skills`, `/memory`, `/model`, `/mcp` (Esc closes; scroll preserved).
- **Composer** — multiline, `@file` Tab-complete, `@memory:` refs.
- **Activity** — tool call banner during turns; thinking strip when model streams reasoning (Ctrl+T).

## Skills

Bundled: `memory-ops`, `browser-ops`, `obsidian-ops`, `cron-ops` (see `skills/`). Drop more under `skills/<name>.md` with frontmatter:

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

## Workspace context (`@file` / `@dir`)

```bash
csagent run "review @file:src/cli.ts"
csagent run "what lives in @dir:src?"
```

Paths are relative to project cwd; traversal outside the workspace is blocked. The safety gate checks the **composed prompt** — destructive content smuggled via `@file`/`@memory` hits the same denylist.

## Memory (`@memory`)

```bash
csagent memory add tparser --stdin <<'EOF'
# TParser
XSS alerts: Reports/analysis/digest_qa_*.md
EOF
```

In chat/TUI: `@memory:tparser` or `/memory`. Secrets redacted on save.

**Secure notes (Postgres only):** `csagent memory add vault --wing secure --stdin` — body is pgcrypto-encrypted at rest (`CSAGENT_SECRETS_KEY`), never mirrored to `.md`, masked in `memory list`/`search`; only `memory show` (and MCP `memory_get`) decrypts. SQLite store refuses the `secure` wing explicitly.

**Default (MCP-first):** do not set `memory.onStart`. The built-in MCP server `csagent-memory` is attached automatically (`memory.mcp`, default true). On any turn the agent can call `memory_search`, `memory_get`, `memory_list`, `memory_save`, `memory_fact_query`, `memory_fact_add`, `memory_fact_invalidate`. Enable skill `memory-ops` in `gateway.json` for Telegram so the model queries memory before guessing. With `browser.mcp: true`, add skill `browser-ops` so gateway/cron use `browser_navigate` / `browser_snapshot` instead of guessing page content. For Obsidian vault read/write, add `obsidian-ops` and set `OBSIDIAN_VAULT_PATH` in `csagent.env`.

```json
"memory": { "mcp": true }
```

**Manual inject:** `@memory:name` in a message still works. **Advanced:** optional `memory.onStart` (1–2 short notes on first turn only) — avoid with large libraries; use MCP search instead.

### Semantic search (Postgres + local embeddings)

Local Ollama-compatible embeddings (default `nomic-embed-text`, 768d) + pgvector:

```json
"memory": { "mcp": true, "embeddings": { "enabled": true } }
```

Optional: `"url": "http://127.0.0.1:11434"`, `"model": "nomic-embed-text"`. With this on, every note save computes an embedding (fail-soft if the daemon is down); secure-wing notes are **never** embedded.

```bash
csagent memory search "how do consumers split shards" --semantic
csagent memory reindex-embeddings     # backfill notes saved before enabling
```

MCP: `memory_search` accepts `semantic: true` (falls back to keyword FTS when no vectors match). Requires `ollama pull nomic-embed-text` and the Postgres store.

### Episodic memory (session ingest, P3-2)

Recent chat sessions are upserted as searchable notes in wing **`episodic`** (`ep.<sessionId>`). Idempotent: re-ingests only when `session.updated_at` is newer than the note.

```bash
csagent memory ingest-sessions              # last 7 days (default)
csagent memory ingest-sessions --window-hours 48 --force
```

Cron builtin: `"builtin": "session-ingest"` (example: nightly after `session-export`). Episodic notes are for MCP/`memory_search` — not bulk `@memory:*` injection.

### Auto-RAG (optional, conservative pilot — I-55)

When enabled, each turn silently runs memory search on the user message and prepends top hits **after** preTurn (profile/mode) and **before** `# Task`. Default **off** — MCP-first (`memory_search` on demand).

**Separate from preTurn (I-52):** profiles and mode prefixes belong in `memory.preTurn`, not autoRag. Do **not** include wing `meta` in `autoRag.wings` without explicit HITL sign-off — doctor warns if `meta` is listed while enabled.

Reference config (`deploy/agent.config.example.json`):

```json
"memory": {
  "mcp": true,
  "autoRag": {
    "enabled": false,
    "limit": 2,
    "semantic": false,
    "maxChars": 4000,
    "wings": ["default"]
  }
}
```

Pilot enable/rollback and metrics: [deploy/PERSONAL-OPS.md](deploy/PERSONAL-OPS.md#autorag-pilot). With `CSAGENT_LOG=1`, each turn logs one line: `autoRag hits=N chars=M notes=name1,name2` (names only, no body).

### Turn context — mode prefix + profile excerpt (I-52)

Optional built-in preTurn injection (gateway/TUI/chat). **Mode** applies on every turn; **profile** only on the first turn of a session (skipped on live SDK resume, same as skills/onStart).

**Message prefixes** (case-insensitive, stripped from task text):

| Prefix | Meaning |
|--------|---------|
| `ADVICE:` | Discuss options; do not implement unless asked |
| `DO:` | Implement or execute; minimal preamble |
| `DEBUG:` | Investigate root cause before fixing |
| `SYNC:` | Status update only |

Example: `ADVICE: проверь cron` → composed prompt contains `Mode: ADVICE` and task `проверь cron`.

```json
"memory": {
  "preTurn": {
    "profileNote": "user-profile.niksh",
    "profileMaxChars": 1500,
    "modeEnv": "CSAGENT_MODE"
  }
}
```

When `preTurn` is configured, `CSAGENT_MODE=ADVICE|DO|DEBUG|SYNC` applies when the message has no prefix. Profile excerpt is fail-soft (missing note → no block). Does **not** inject `agent-profile.composer` — use MCP `memory_get` for that.

## Cron (scheduled jobs)

`.agent/cron.jobs.json` (five-field cron, **local time**, Vixie semantics: dom OR dow when both restricted). Examples: `deploy/cron.jobs.example.json`.

**Context artifacts** (I-40, Wave C1a) — after each successful run with output, the job writes `.agent/cron.context/{jobId}.json`:

```json
{
  "jobId": "tparser-daily-digest",
  "at": "2026-06-13T20:59:00.000Z",
  "ok": true,
  "exitCode": 0,
  "output": "… redacted, max 256 KiB …",
  "truncated": false,
  "format": "text"
}
```

Fail-soft write; downstream prompt injection is [I-41](issues/I-41-cron-context-from-field.md). Script jobs persist stdout; builtins without output skip artifacts.

**TParser daily digest** (`topicDelegates: true`) — five isolated `runDelegate` passes (AI/ML, AISec, InfoSec, Programming, DevOps) over a 24h window, then a synthesizer `runPrompt` → Telegram digest + **post-mortem** (`status`, duration, topics). Default schedule: **`59 23 * * *`**. Prompts: `deploy/prompts/tparser-daily-topic.prompt.txt`, `tparser-daily-synthesize.prompt.txt`.

Synthesizer targets **≤3500 chars** with a **TL;DR** paragraph first (I-60). Transport still accepts up to 12k (multipart/outbox); `cron qa` **WARN**s on 3501–12000, **FAIL** only above 12k. Optional future job field `notify.maxChars` (documented, not enforced yet) would cap notify text before send.

```json
{
  "version": 1,
  "jobs": [
    {
      "id": "tparser-daily-digest",
      "cron": "59 23 * * *",
      "graceMinutes": 480,
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
csagent cron qa                    # digest QA (after first nightly run)
csagent cron tick    # launchd ai.csagent.cron-tick every 5 min, or system crontab
```

Job extras:

- `"graceMinutes": 480` — lookback for missed slots (machine slept through the scheduled minute); missed-slot backlog collapses into one catch-up run.
- `"catchUp": "skip"` — drop stale slots instead of catching up (briefings that must not arrive late). Default `"once"`.
- `"gateScript": "path.sh"` — cheap pre-check before waking the SDK: last stdout line `{"wakeAgent": false, "reason": "…"}` skips the run entirely (no tokens, no notify; slot is consumed). Fail-open: gate errors never block the job. Manual `cron run` bypasses the gate.
- `"script": "path.sh"` — deterministic shell job with **no SDK at all**: non-empty stdout → notify text; empty stdout → silent success; non-zero exit → failed with stderr. Example: `deploy/scripts/csagent-watchdog.sh` (gateway/outbox/cron health, zero tokens).
- Builtins: `"builtin": "memory-audit"` (notes/facts/silo QA + seen_post TTL prune), `"builtin": "session-export"` (daily transcripts → `Reports/sessions/YYYY-MM-DD/`), `"builtin": "session-ingest"` (sessions → episodic memory notes).
- Tick takes a cross-process lock (`cron.tick.lock`) — overlapping ticks skip instead of double-firing.
- Optional `sessionId` binds to an existing `sess_`. Destructive prompts denied unless `"yesIUnderstand": true`. Doctor checks the **cron prompt guard** (injection patterns).

**From Telegram (preferred):** ask the agent to schedule a job → it calls MCP `cron_propose` → confirm with `/schedule approve <code>`. Fallback slash: `/schedule add <cron> <id> <prompt…>` — see `/schedule help`. Skill `cron-ops` + gateway chat id required for MCP tools.

## Gateway (webhook / Telegram → chat)

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
  "telegram": { "tokenEnv": "TELEGRAM_BOT_TOKEN", "pollIntervalMs": 2000, "messageFormat": "rich" },
  "allowedChatIds": ["YOUR_CHAT_ID"],
  "skills": ["memory-ops", "browser-ops", "obsidian-ops"]
}
```

```bash
csagent auth telegram login --stdin   # or --from-env
csagent gateway run --adapter telegram
```

Each `chatId` → stable `sess_` (visible in `csagent sessions` / TUI). Allowlist required; unknown chats get a **pairing code** (capped, 24h TTL) — admin in allowlist runs `/approve <code>`. Both adapters honor approved pairings.

Delivery: agent replies and digests use Bot API **Rich Messages** (`sendRichMessage` + native markdown, default) with fallback to HTML `sendMessage`, then plain text. Set `telegram.messageFormat` to `"html"` or `"plain"` in `gateway.json`. Tool progress stays plain one-liners (self-updating via `editMessageText`). Failed sends park in `gateway.outbox.json` and drain with backoff — replies and digests survive restarts and network outages. Per-chat queues keep one slow turn from blocking other chats.

**Telegram slash commands (csagent catalog, no LLM):**

| Command | Action |
|---------|--------|
| `/help` | List commands (same as Bot menu) |
| `/new` | Fresh session for this chat |
| `/status` | Gateway + launchd status + outbox + 24h run metrics |
| `/doctor` | Short environment check |
| `/memory [q]` | List or search durable notes |
| `/sessions [q]` | Recent sessions for this chat |
| `/skills` | Skills from `gateway.json` |
| `/approve <code>` | Approve pairing for new chatId |
| `/schedule …` | Cron from chat (`add`, `approve`, `list`, `remove`) |
| `/delegate <prompt>` | Isolated subagent run; summary **injected** into this chat's `sess_` |

On gateway start, `setMyCommands` syncs this menu to Telegram. Free text → Cursor SDK agent turn. SIGINT drains in-flight turns, then disposes SDK agents.

## MCP servers

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

Browser tools: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_save_session`, `browser_load_session`, `browser_close`. Profile data: `<stateDir>/browser/`. Set `CSAGENT_CHROME_PATH` or `browser.chromePath` if Puppeteer's bundled Chromium is not installed.

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

State: SQLite at `<stateDir>/state.sqlite` by default, or Postgres when `CSAGENT_DATABASE_URL` is set. Previews redacted; no secrets stored. Ops run log: `<stateDir>/logs/runs.jsonl` (no previews; `CSAGENT_RUN_LOG=0` disables).

**Cloud (016):** `runtime: "cloud"` + `safety.allowCloud` only gate today — **no real cloud SDK path** (deliberately deferred: cloud agents run without access to the local machine, which defeats the local-first design).

## Safety

- `run` / `resume` / cron: non-interactive destructive prompts **denied** (exit 77); `--yes-i-understand` overrides.
- `chat` / `tui`: interactive confirm (or `--yes-i-understand`).
- Gate runs on the **composed prompt** (message + expanded `@file`/`@memory` refs).
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
npm test            # mocked SDK; PG-gated tests need CSAGENT_TEST_PG_URL
npm run accept      # MVP acceptance harness
npm run smoke       # live SDK (needs key)
```

Optional diagnostics: `CSAGENT_LOG=1` in `csagent.env` (rotation, runs → gateway.log; TUI writes `.agent/tui.log`); `CSAGENT_LOG_VERBOSE=1` for per-tool lines.

Idle sessions: `CSAGENT_AGENT_IDLE_MS` (default `1200000` = 20 min) proactively refreshes the SDK agent before the next turn; set `0` to disable.

## Architecture

Cursor SDK is the sole agent runtime (no parallel model/provider loop). Shared chat engine powers CLI, TUI, cron, and gateway.

| Module | Role |
|--------|------|
| `src/cli.ts` | command dispatch |
| `src/chatEngine.ts` | shared chat + rotation + `injectContext` |
| `src/delegateRun.ts` `src/cronTopicDigest.ts` | TUI/cron subagent delegates |
| `src/tui/` | Ink TUI |
| `src/store.ts` | SQLite or Postgres store (+ JSONL run log) |
| `src/memory*.ts` `src/cron*.ts` `src/gateway*.ts` | automation surfaces |
| `src/browser/` `src/mcp/browser*.ts` | stealth browser MCP |
| `src/gatewaySlash.ts` `src/gatewayPairing.ts` `src/gatewayOutbox.ts` | Telegram slash, pairing, delivery queue |
| `src/safety.ts` `src/redact.ts` | gate + redaction |
