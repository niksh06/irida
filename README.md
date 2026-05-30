# cursor-agent

Local-first personal agent powered by the [Cursor SDK](https://cursor.com/docs/sdk/typescript). Hermes-inspired UX (sessions, skills, MCP, safety) without a second model/provider/tool loop — Cursor's own agent runtime executes the work.

> MVP is **local-only**. No cloud runs, messaging gateway, or cron yet. **Ink TUI** is available via `csagent tui` (see `docs/issues/020-tui.md`).

## Requirements

- Node.js **>= 20** (uses built-in `node:sqlite`, `node --test`).
- A Cursor API key in the environment:

```bash
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

```bash
npm run doctor                       # environment checks (key, node, cwd, config, mcp)
npm run dev -- run "summarize repo"  # one-shot local task (Agent.prompt)
npm run chat                         # interactive multi-turn session (Agent.create)
npm run tui                          # Hermes-style Ink TUI (slash cmds, sessions, scroll)
npm run sessions                     # list stored sessions (newest first)
npm run resume -- <id> "<prompt>"  # continue a stored session (Agent.resume; replay fallback)
npm run config                       # print non-secret config
```

After `npm link` (optional global install of **this** CLI):

```bash
csagent doctor
csagent run "summarize this repository"
```

> **Resume caveat:** Cursor SDK local agents are not reliably durable after the process exits. `resume` tries live `Agent.resume` first; if that fails (common for local), it falls back to **transcript replay** — a fresh agent seeded with the stored (redacted, truncated) transcript. Context is approximate. Cloud (`bc-`) agents resume natively.

During development, any subcommand works via `npm run dev --`:

```bash
npm run dev -- doctor
npm run dev -- run "summarize this repository"
```

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

Select per run (repeatable); content is injected as **context**, never executed:

```bash
npm run dev -- run --skill terse "capital of France"
npm run dev -- chat --skill terse
```

### Workspace context (`@file` / `@dir`)

Attach local files or directory listings inline before the SDK call:

```bash
npm run dev -- run "review @file:src/cli.ts"
npm run dev -- run "what lives in @dir:src?"
```

Paths are relative to project cwd; traversal outside the workspace is blocked.

List or search installed skills:

```bash
npm run dev -- skills list
npm run dev -- skills search review
```

### MCP servers

Configured in `agent.config.json` and passed inline to every SDK call (and on resume):

```json
{
  "mcpServers": {
    "fs":  { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    "web": { "url": "https://example.com/mcp" }
  }
}
```

`npm run doctor` (or `csagent doctor`) validates each entry (stdio needs `command`, http needs `url`).

## Configuration

Project-local `agent.config.json` (all fields optional; defaults shown). **Secrets never go here** — `CURSOR_API_KEY` comes from the environment.

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

State (sessions + runs) is stored in `<stateDir>/state.sqlite`. No secrets are persisted; prompt previews are redacted.

## Safety

- One-shot `run` and `resume` are non-interactive: detected destructive prompts are **denied** (exit 77). Override with `--yes-i-understand`.
- `chat` and `tui` are interactive: destructive prompts require confirmation (`--yes-i-understand` skips it). **TUI:** trackpad scroll (default), `⌃[`/`⌃]` session tabs, `/model` `/mcp` `/copy`, `/help` for all commands.
- API keys and key-shaped tokens are redacted from logs and persisted state.

> **Limitation (honest):** destructive detection is a best-effort **regex denylist**, not a sandbox or security boundary. It catches common shapes (`rm -rf`, `drop table`, force-push, fork bombs) but is trivially bypassed by obfuscation, and it does **not** police what the Cursor agent does with its own tools. Treat it as a speed-bump.

## Exit codes

BSD `sysexits(3)` convention (so callers/CI can branch on failure class):

| Code | Name | Meaning |
|------|------|---------|
| `0` | EX_OK | run finished |
| `64` | EX_USAGE | bad CLI usage: missing/extra args, unknown command/session/skill |
| `70` | EX_SOFTWARE | executed run failed (`status === "error"`) or SDK startup/resume failure |
| `77` | EX_NOPERM | unsafe destructive prompt denied/declined |
| `78` | EX_CONFIG | missing `CURSOR_API_KEY`, invalid config, cloud not allowed |

`doctor` is a diagnostic: `0` = all checks pass, `1` = some failed.

## Develop

```bash
npm run typecheck
npm test            # full unit suite (mocked SDK, CI-safe)
npm run accept      # MVP acceptance harness
npm run smoke       # live smoke vs real Cursor SDK (needs CURSOR_API_KEY)
```

The acceptance harness (`test/acceptance.test.ts`) proves doctor / run / chat / sessions / resume / safety / redaction end-to-end without live Cursor calls.

## Architecture

See `docs/adr/0001-cursor-sdk-agent-runtime.md`. Briefly: thin command layer over the Cursor SDK.

| Module | Role |
|--------|------|
| `src/cli.ts` | command dispatch |
| `src/config.ts` | project config + validation |
| `src/host.ts` | SDK lifecycle (prompt / create+send / resume), failure model |
| `src/run.ts` `src/chat.ts` `src/chatEngine.ts` `src/resume.ts` | command runtimes |
| `src/tui/` | Ink TUI (`csagent tui`) |
| `src/store.ts` | SQLite sessions/runs |
| `src/skills.ts` `src/promptBuilder.ts` | skill loading + prompt composition |
| `src/safety.ts` `src/redact.ts` | destructive-prompt gate + secret redaction |

## License

ISC
