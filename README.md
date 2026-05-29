# cursor-agent

Local-first personal agent powered by the [Cursor SDK](https://cursor.com/docs/sdk/typescript). Hermes-inspired UX (sessions, skills, MCP, safety) without a second model/provider/tool loop — Cursor's own agent runtime executes the work.

> MVP is **local-only**. No cloud runs, messaging gateway, cron, dashboard, or TUI yet (see `docs/prd/cursor-sdk-agent.md`).

## Requirements

- Node.js **>= 20** (uses built-in `node:sqlite`, `node --test`).
- A Cursor API key in the environment:

```bash
export CURSOR_API_KEY="cursor_..."   # Dashboard → Integrations
```

## Install

```bash
npm install
npm run build      # compile to dist/  (or use npm run dev for ts directly)
```

## Commands

```bash
cursor-agent doctor                  # environment checks (key, node, cwd, config, mcp)
cursor-agent run "<prompt>"          # one-shot local task (Agent.prompt)
cursor-agent chat                    # interactive multi-turn session (Agent.create)
cursor-agent sessions                # list stored sessions (newest first)
cursor-agent resume <id> "<prompt>"  # continue a stored session (Agent.resume)
cursor-agent config                  # print non-secret config
```

During development run without building:

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
cursor-agent run --skill terse "capital of France"
cursor-agent chat --skill terse
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

`cursor-agent doctor` validates each entry (stdio needs `command`, http needs `url`).

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

- One-shot `run` and `resume` are non-interactive: detected destructive prompts are **denied** (exit 3).
- `chat` is interactive: destructive prompts require `[y/N]` confirmation.
- API keys and key-shaped tokens are redacted from logs and persisted state.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | run finished |
| `1` | startup/config/auth failure (nothing executed) |
| `2` | executed run failed (`status === "error"`) |
| `3` | unsafe prompt denied / declined |

## Develop

```bash
npm run typecheck
npm test            # full unit suite
npm run accept      # MVP acceptance harness (mocked SDK, CI-safe)
```

The acceptance harness (`test/acceptance.test.ts`) proves doctor / run / chat / sessions / resume / safety / redaction end-to-end without live Cursor calls.

## Architecture

See `docs/adr/0001-cursor-sdk-agent-runtime.md`. Briefly: thin command layer over the Cursor SDK.

| Module | Role |
|--------|------|
| `src/cli.ts` | command dispatch |
| `src/config.ts` | project config + validation |
| `src/host.ts` | SDK lifecycle (prompt / create+send / resume), failure model |
| `src/run.ts` `src/chat.ts` `src/resume.ts` | command runtimes |
| `src/store.ts` | SQLite sessions/runs |
| `src/skills.ts` `src/promptBuilder.ts` | skill loading + prompt composition |
| `src/safety.ts` `src/redact.ts` | destructive-prompt gate + secret redaction |

## License

ISC
