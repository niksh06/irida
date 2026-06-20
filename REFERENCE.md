# irida — Reference

Full command, configuration, and architecture reference. Install and deployment live in [OPS.md](OPS.md); quickstart in [README.md](README.md).

> **Name collision:** if you have Cursor CLI installed, `cursor-agent` in your PATH is **Cursor's official agent**, not this repo. It has no `doctor` subcommand — `doctor` is treated as a prompt and the process hangs. Use **`irida`**, **`npm run doctor`**, or **`npm run dev -- …`**.

## Commands

### Core

```bash
irida doctor                       # key, node, cwd, config, mcp, cron/gateway files, API probe
irida run "summarize repo"         # one-shot (Agent.prompt)
irida chat                         # interactive multi-turn (Agent.create)
irida tui                          # Ink TUI (recommended)
irida sessions                     # list sess_ (newest first)
irida sessions search <query>      # filter by id / title / cwd
irida resume <sess_id> "follow up" # live resume or transcript replay
irida store migrate [pg-url]       # one-shot sqlite → postgres (sessions/runs/memory)
irida config                       # print non-secret config
irida skills list|search <q>       # local Markdown skills
```

### Auth

```bash
irida auth login --stdin           # save key to .agent/credentials.json
irida auth status                  # configured? (never prints secret)
irida auth logout                  # remove credentials file
```

### Memory, cron, gateway

```bash
irida memory list|show|add|search|rm …
irida memory align-silo [--dry-run]   # merge repo/cron silos → IRIDA_HOME memory
irida memory audit [--links] [--stale-days 90]  # notes/facts/silo QA
irida memory purge-archive [--wing cursor-ide] [--older-than-days 180] [--require-lesson] [--apply]
irida memory fact add|query|invalidate …
irida cron list|run <id>|tick|qa
irida gateway status         # launchd + log probe + outbox + 24h run metrics
irida gateway run [--adapter webhook|telegram] [--port 18789]
```

During development: `npm run dev -- <subcommand>` (same as above).

> **Resume caveat:** local SDK agents are not reliably durable after process exit. `resume` tries live `Agent.resume` first; on failure it **replays the stored transcript** into a fresh agent.

## TUI (`irida tui`)

- **Session tabs** — recent `sess_` in the header; **`1`–`5`**, **Tab** / **Shift+Tab**, **←**/**→** (empty composer), **Ctrl+[** / **Ctrl+]** to switch.
- **Slash commands** — `/help`, `/sessions`, `/skills`, `/memory`, `/model`, `/export`, `/tools`, `/doctor`, `/delegate <prompt>` (isolated run + **inject** into parent `sess_`), `/find <text>` (transcript search; repeat = older match), `/new`, `/resume <id>`, `/clear`, `/copy`, `/rename`, `/exit`, …
- **Overlays** — `/sessions`, `/skills`, `/memory`, `/model`, `/mcp` (Esc closes; scroll preserved).
- **Composer** — multiline, `@file` Tab-complete, `@memory:` refs.
- **Activity** — tool call banner during turns; thinking strip when model streams reasoning (Ctrl+T).

## Skills

Bundled: `memory-ops`, `browser-ops`, `obsidian-ops`, `cron-ops` (see `skills/`). Drop more under `skills/<name>.md` with frontmatter.

**Where skills live:** one directory on disk, resolved by `resolveSkillsRoot()`:

| Layout | Skills root |
|--------|-------------|
| Dev (repo checkout) | `<repo>/skills/` |
| Prod (`~/.irida` home) | **`$IRIDA_ROOT/skills`** (typically `~/.irida/csagent/skills`) |

Resolution order: `IRIDA_HOME` + `skillsPath` → **`IRIDA_ROOT`** + `skillsPath` → `cwd` + `skillsPath`. Gateway uses `IRIDA_HOME` for state (`.agent/gateway.json`) but loads skills from the install copy. `irida doctor` prints `skills root: …`; `irida skills list` prints `Skills root: …`. There is no separate `~/.irida/skills/` unless you create an overlay.

```markdown
---
name: terse
description: answer in one word
tags: [style]
---
Always answer with exactly one lowercase word.
```

```bash
irida run --skill terse "capital of France"
irida chat --skill terse
```

## Workspace context (`@file` / `@dir`)

```bash
irida run "review @file:src/cli.ts"
irida run "what lives in @dir:src?"
```

Paths are relative to project cwd; traversal outside the workspace is blocked. The safety gate checks the **composed prompt** — destructive content smuggled via `@file`/`@memory` hits the same denylist.

## Memory (`@memory`)

```bash
irida memory add tparser --stdin <<'EOF'
# TParser
XSS alerts: Reports/analysis/digest_qa_*.md
EOF
```

In chat/TUI: `@memory:tparser` or `/memory`. Secrets redacted on save.

### Technology knowledge base (file, not Postgres)

HappyIn-style reference lives at **`$IRIDA_HOME/knowledge-space`** (git clone). Articles: `docs/{domain}/{slug}.md`. Update: `git pull`. Agents use skill **`kb-ops`** — Grep/Read on disk; enable in `gateway.json` alongside `memory-ops`. See [skills/kb-ops.md](skills/kb-ops.md). Do not use `memory_search` for stack documentation.

Legacy CLI `irida memory import-md` (bulk copy into PG) is **deprecated** for prod — prefer file KB.

**Secure notes (Postgres only):** `irida memory add vault --wing secure --stdin` — body is pgcrypto-encrypted at rest (`IRIDA_SECRETS_KEY`), never mirrored to `.md`, masked in `memory list`/`search`; only `memory show` (and MCP `memory_get`) decrypts. SQLite store refuses the `secure` wing explicitly.

**Default (MCP-first):** do not set `memory.onStart`. The built-in MCP server `csagent-memory` is attached automatically (`memory.mcp`, default true). On any turn the agent can call `memory_search`, `memory_get`, … Enable skills `memory-ops` and **`kb-ops`** in `gateway.json` — memory for agent state, kb-ops for technology reference on disk.

```json
"memory": { "mcp": true }
```

**Manual inject:** `@memory:name` in a message still works. **Advanced:** optional `memory.onStart` (1–2 short notes on first turn only) — avoid with large libraries; use MCP search instead.

### When memory is retrieved

Four independent layers; only the ones you enable run. Order in `composePrompt`: **preTurn** → **onStart** (first turn) → **autoRag** → user message (`# Task`).

| Layer | Config | When | Prod default |
|-------|--------|------|--------------|
| **preTurn** | `memory.preTurn` | Every turn — mode prefix; profile excerpt on **first turn only** (skipped on live SDK resume) | on if configured (I-52) |
| **onStart** | `memory.onStart` | First turn only — inject named notes | **off** |
| **autoRag** | `memory.autoRag` | Every turn — silent `searchNotes` on user text, prepends hits | **off** (MCP-first, I-55) |
| **MCP `memory_search`** | `memory.mcp` (default true) | Model tool call on demand | on-demand via skill `memory-ops` |

**CLI** `irida memory search` is manual — cron/gateway never call it unless a job prompt or agent tool does.

**Default search scope:** wings `cursor-ide`, `secure`, and `episodic` are excluded from FTS/semantic unless opted in (`includeArchive`, `includeEpisodic`, or CLI flags). Meta notes are included. Secure notes match by name/title only; body stays encrypted.

See also: [Auto-RAG pilot](#auto-rag-optional-conservative-pilot--i-55), [Cursor IDE transcripts](#cursor-ide-transcripts-p3-3--r4-4), [Memory governance](docs/MEMORY-GOVERNANCE.md) (files vs Postgres, OKF, LLM wiki, review checklist).

### Semantic search (Postgres + local embeddings)

Local Ollama-compatible embeddings (default `nomic-embed-text`, 768d) + pgvector:

```json
"memory": { "mcp": true, "embeddings": { "enabled": true } }
```

Optional: `"url": "http://127.0.0.1:11434"`, `"model": "nomic-embed-text"`. With this on, every note save computes an embedding (fail-soft if the daemon is down); secure-wing notes are **never** embedded.

```bash
irida memory search "how do consumers split shards" --semantic
irida memory reindex-embeddings     # backfill notes saved before enabling
```

MCP: `memory_search` accepts `semantic: true` (falls back to keyword FTS when no vectors match). Requires `ollama pull nomic-embed-text` and the Postgres store.

### Episodic memory (session ingest, P3-2)

Recent chat sessions are upserted as searchable notes in wing **`episodic`** (`ep.<sessionId>`). Idempotent: re-ingests only when `session.updated_at` is newer than the note.

```bash
irida memory ingest-sessions              # last 7 days (default)
irida memory ingest-sessions --window-hours 48 --force
```

Cron builtin: `"builtin": "session-ingest"` (example: nightly after `session-export`). Episodic notes are for MCP/`memory_search` — not bulk `@memory:*` injection.

### Cursor IDE transcripts (P3-3 / R4-4)

Parent chats under `~/.cursor/projects/*/agent-transcripts/*.jsonl` → wing **`cursor-ide`** (`cursor.<uuid>`). Text-only (tool traces omitted); redacted on save. Skips files whose mtime is not newer than the stored note; re-imports when the jsonl grows across sessions.

**Search:** `cursor-ide` is excluded from default FTS/semantic (archive). Use `--include-archive` or MCP `includeArchive: true` for forensic lookup.

```bash
irida memory mine-cursor                    # last 7 days, max 30 (default)
irida memory mine-cursor --all              # every transcript (backfill + daily cron)
irida memory search "gateway cron"          # skips cursor-ide
irida memory search "gateway cron" --include-archive
```

Cron builtin: `"builtin": "cursor-mine"` (scans all transcripts; example `cursor-mine-daily` at `15 0 * * *`).

### Cursor lesson distill (I-65)

Compressed playbooks from raw `cursor-ide` archive → wing **`cursor-lesson`** (`lesson.<uuid>`). **Included in default search** (unlike archive). HITL: cron writes proposals only; profile patches never auto-merge to `meta`.

```bash
irida memory distill-cursor              # delta queue (top 10, respects baseline)
irida memory distill-cursor --backfill --limit 10   # backfill batch
irida memory distill-cursor --backfill --run --parallel 3 --limit 10   # map-reduce SDK batch (composer-2.5-fast)
irida memory distill-cursor --backfill --run --dry-run   # chunk plan only
irida memory distill-cursor --show-baseline
irida memory distill-cursor --set-baseline --baseline-note "backfill complete"
```

State file: `.agent/cursor-distill.baseline.json` — after baseline, only archives **updated after** that timestamp are queued (delta).

Weekly flow (example, disabled in repo):

1. `cursor-distill-queue-weekly` builtin — builds queue artifact
2. `cursor-lesson-weekly` SDK job + skill `cursor-lesson-ops` — distills queue via `memory_save`

Template: `deploy/prompts/cursor-lesson.template.md` (OKF v0.1 Playbook)

**Canonical playbooks** (operator-authored, stable names): `lesson.gateway-idle-rotation` — see `deploy/prompts/cursor-lesson-canonical-idle-rotation.md`. Load: `irida memory add lesson.gateway-idle-rotation --wing cursor-lesson --stdin --dir <config-dir>`.

**Delta upsert:** weekly distill must use queue **Lesson name** exactly; stale → overwrite, never fork. Optional `memory_fact_add` (`cursor_lesson`, lesson name, decision).

**OKF hygiene & review:**

```bash
irida memory okf audit [--json]
irida memory okf migrate-lessons [--apply]   # legacy HTML → YAML frontmatter
irida memory okf backfill-lineage [--apply] # sourceHash from archive (lineage audit)
irida memory okf repair-titles [--apply]    # fix uuid placeholder titles
irida memory okf strip-legacy-meta [--apply] # drop HTML lineage when YAML present
irida memory okf promote [--apply] [--keep-file deploy/promote-lessons.json] # HITL → status: approved
irida memory okf export-review [--out Reports/cursor-lesson-review]
irida memory okf export-bundle [--bundle-out .agent/memory/okf/cursor-lesson] [--exclude-fixtures]
```

**Browse on disk:** Postgres is source of truth; `export-bundle` mirrors the current corpus to markdown under `{config-dir}/.agent/memory/okf/cursor-lesson/` (use `--dir` for prod). Re-export removes stale `*.md` orphans from prior runs.

```bash
irida memory okf purge-stubs [--apply] [--fixtures-only | --stubs-only]   # phase-1 hygiene
irida memory okf purge-meta-distill [--apply] [--keep-file deploy/meta-distill-keep.json]   # phase-2
irida memory okf purge-tparser [--apply] [--keep-file deploy/tparser-keep.json]
irida memory okf purge-gateway [--apply] [--keep-file deploy/gateway-keep.json]
```

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

Pilot enable/rollback and metrics: [deploy/PERSONAL-OPS.md](deploy/PERSONAL-OPS.md#autorag-pilot). With `IRIDA_LOG=1`, each turn logs one line: `autoRag hits=N chars=M notes=name1,name2` (names only, no body).

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
    "modeEnv": "IRIDA_MODE"
  }
}
```

When `preTurn` is configured, `IRIDA_MODE=ADVICE|DO|DEBUG|SYNC` applies when the message has no prefix. Profile excerpt is fail-soft (missing note → no block). Does **not** inject `agent-profile.composer` — use MCP `memory_get` for that.

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
irida cron list
irida cron run tparser-daily-digest
irida cron qa                    # digest QA (after first nightly run)
irida cron tick    # launchd ai.csagent.cron-tick every 5 min, or system crontab
```

Job extras:

- `"graceMinutes": 480` — lookback for missed slots (machine slept through the scheduled minute); missed-slot backlog collapses into one catch-up run.
- `"catchUp": "skip"` — drop stale slots instead of catching up (briefings that must not arrive late). Default `"once"`.
- `"gateScript": "path.sh"` — cheap pre-check before waking the SDK: last stdout line `{"wakeAgent": false, "reason": "…"}` skips the run entirely (no tokens, no notify; slot is consumed). Fail-open: gate errors never block the job. Manual `cron run` bypasses the gate.
- `"script": "path.sh"` — deterministic shell job with **no SDK at all**: non-empty stdout → notify text; empty stdout → silent success; non-zero exit → failed with stderr. Example: `deploy/scripts/csagent-watchdog.sh` (gateway/outbox/cron health, zero tokens).
- Builtins: `"builtin": "memory-audit"` (notes/facts/silo QA), `"builtin": "session-export"` (daily transcripts → `Reports/sessions/YYYY-MM-DD/`), `"builtin": "session-ingest"` (sessions → episodic memory notes), `"builtin": "cursor-mine"` (all Cursor IDE transcripts → wing `cursor-ide`), `"builtin": "cursor-distill-queue"` (stale/missing distill candidates for I-65). Legacy `seen_post` facts: `irida memory fact purge-seen-post`.
- Tick takes a cross-process lock (`cron.tick.lock`) — overlapping ticks skip instead of double-firing.
- Optional `sessionId` binds to an existing `sess_`. Destructive prompts denied unless `"yesIUnderstand": true`. Doctor checks the **cron prompt guard** (injection patterns).

**From Telegram (preferred):** ask the agent to schedule a job → it calls MCP `cron_propose` → confirm with `/schedule approve <code>`. Fallback slash: `/schedule add <cron> <id> <prompt…>` — see `/schedule help`. Skill `cron-ops` + gateway chat id required for MCP tools.

## Gateway (webhook / Telegram → chat)

`.agent/gateway.json`. Webhook secret via env; Telegram token via **`irida auth telegram login --stdin`** (same `credentials.json`) or env.

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
irida gateway run
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
irida auth telegram login --stdin   # or --from-env
irida gateway run --adapter telegram
```

Each `chatId` → stable `sess_` (visible in `irida sessions` / TUI). Allowlist required; unknown chats get a **pairing code** (capped, 24h TTL) — admin in allowlist runs `/approve <code>`. Both adapters honor approved pairings.

Delivery: agent replies and digests use Bot API **Rich Messages** (`sendRichMessage` + native markdown, default) with fallback to HTML `sendMessage`, then plain text. Set `telegram.messageFormat` to `"html"` or `"plain"` in `gateway.json`. Tool progress stays plain one-liners (self-updating via `editMessageText`). Failed sends park in `gateway.outbox.json` and drain with backoff — replies and digests survive restarts and network outages. Per-chat queues keep one slow turn from blocking other chats.

**Telegram slash commands (irida catalog, no LLM):**

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

Browser tools: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_save_session`, `browser_load_session`, `browser_close`. Profile data: `<stateDir>/browser/`. Set `IRIDA_CHROME_PATH` or `browser.chromePath` if Puppeteer's bundled Chromium is not installed.

## Configuration

Project-local `agent.config.json`. **Secrets never go here.**

| Secret | Use when |
|--------|----------|
| `irida auth login --stdin` | Cursor API key → `.agent/credentials.json` or Postgres (pgcrypto) |
| `irida auth telegram login --stdin` | Telegram bot token (same stores) |
| `export IRIDA_SECRETS_KEY=…` | With `IRIDA_DATABASE_URL` — encrypt tokens in `credential_secrets` |
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

State: SQLite at `<stateDir>/state.sqlite` by default, or Postgres when `IRIDA_DATABASE_URL` is set. Previews redacted; no secrets stored. Ops run log: `<stateDir>/logs/runs.jsonl` (no previews; `IRIDA_RUN_LOG=0` disables). Each line includes optional **I-68** metadata: `channel` (`telegram` | `cli` | `tui` | `cron` | `run` | …), `cron_job` (when from cron), `is_test` (temp cwd / `IRIDA_TEST=1`). `gateway status` aggregates prod-only (`is_test` excluded). Doctor warns when 24h runs exist but all token fields are null.

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
npm test            # mocked SDK; PG-gated tests need IRIDA_TEST_PG_URL
npm run accept      # MVP acceptance harness
npm run smoke       # live SDK (needs key)
```

Optional diagnostics: `IRIDA_LOG=1` in `irida.env` (rotation, runs → gateway.log; TUI writes `.agent/tui.log`); `IRIDA_LOG_VERBOSE=1` for per-tool lines.

Idle sessions: `IRIDA_AGENT_IDLE_MS` (default `1200000` = 20 min) proactively refreshes the SDK agent before the next turn; set `0` to disable.

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
