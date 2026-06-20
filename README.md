# csagent

Local-first personal agent powered by the [Cursor SDK](https://cursor.com/docs/sdk/typescript). Hermes-inspired UX (sessions, skills, MCP, safety) without a second model/provider/tool loop — Cursor's own agent runtime executes the work.

> **Local-first** by design. **Cron** · **Gateway** (webhook + Telegram) · **Browser MCP** · **Memory** (notes + facts, FTS, pgcrypto) · **Ink TUI** · **530+ tests** green.

## What you get

| Area | Highlights |
|------|------------|
| **CLI / TUI** | `doctor`, `run`, `chat`, `tui` (tabs, slash cmds, `@file`, `/find`), `sessions`, `resume` |
| **Memory** | `@memory:name`, MCP tools, FTS search, encrypted `secure` wing (PG); tech KB via skill `kb-ops` (git markdown) |
| **Cron** | Five-field cron + missed-slot grace, topic-delegate digests, builtins, prompt guard, tick lock |
| **Gateway** | Telegram (long-poll) / webhook → stable session per chat; pairing, slash catalog, HTML replies, persistent outbox |
| **Browser** | `csagent-browser` MCP — stealth Chromium (`browser_navigate`, `browser_snapshot`, …) |
| **Resilience** | In-session SDK agent rotation, idle refresh, delivery queue, JSONL run log + `/status` metrics |
| **Safety** | Destructive prompt gate (composed prompt), secret redaction, BSD exit codes |

## Quickstart (5 minutes, SQLite)

Needs **Node.js ≥ 20** and a **Cursor API key** (Dashboard → Integrations).

```bash
git clone <repo-url> irida && cd csagent
npm install && npm run build
npm link                                   # global `irida`

printf '%s' "cursor_..." | irida auth login --stdin
irida doctor
irida tui                                # or: irida run "summarize this repo"
```

State lives in `./.agent/` (SQLite, credentials chmod 600, memory notes).

> **Name collision:** `cursor-agent` in PATH is Cursor's official CLI, not this repo. Use `irida`.

Next steps:

- **[OPS.md](OPS.md)** — home install (`~/.irida`), Postgres store (gateway/cron/secure notes), launchd services, backups, store switching.
- **[REFERENCE.md](REFERENCE.md)** — all commands, TUI, memory, cron jobs, gateway config, MCP servers, safety, exit codes, architecture.
- **[CHANGELOG.md](CHANGELOG.md)** — what changed.

## Telegram in three commands

```bash
irida auth telegram login --stdin
cp deploy/gateway.json.example .agent/gateway.json   # set your chat id
irida gateway run --adapter telegram
```

Each chat gets a stable session; unknown chats need pairing approval. Digests, schedules (`/schedule`), memory and delegate runs work straight from chat. Details: [REFERENCE.md](REFERENCE.md#gateway-webhook--telegram--chat).

## Develop

```bash
npm run typecheck && npm test    # mocked SDK; PG-gated tests via IRIDA_TEST_PG_URL
npm run pack:check               # npm pack dry-run (tarball whitelist)
```

More: [REFERENCE.md](REFERENCE.md#develop).

## Support the author

If you find **csagent** useful, you can optionally support development on Boosty — entirely voluntary, no perks or obligations:

**[Donate on Boosty](https://boosty.to/niksh612/donate)**

## License

**csagent** (this repository) is licensed under the [ISC License](LICENSE).

### Third-party runtime (not open source)

This project depends on [`@cursor/sdk`](https://www.npmjs.com/package/@cursor/sdk), which is **proprietary software** © Anysphere Inc. Its use is governed by [Cursor Terms of Service](https://cursor.com/terms-of-service), not by this repository's license.

- You need your own **Cursor account** and **API key** (`CURSOR_API_KEY` or `irida auth login`).
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
