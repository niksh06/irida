# cursor-agent

Local-first personal agent powered by the [Cursor SDK](https://cursor.com/docs/sdk/typescript). Hermes-inspired UX (sessions, skills, MCP, safety) without a second model/provider/tool loop — Cursor's own agent runtime executes the work.

> **Local-first** (no cloud runs yet). **Cron** · **Gateway** (webhook + Telegram) · **Ink TUI** · **178 tests** green.

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

```bash
npm install
npm run build      # compile to dist/ (also runs on npm install via prepare)
```

For a global **`csagent`** command, link after build:

```bash
npm link
csagent tui        # launcher rebuilds dist automatically if src/ changed
```

Dev without linking: **`npm run tui`** or **`npm run dev -- tui`** always use current `src/`.

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
  "allowedChatIds": ["123456789"]
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
npm test            # 178 tests, mocked SDK
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
