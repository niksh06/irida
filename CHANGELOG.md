# Changelog

All notable changes to **csagent** are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Cron digest **post-mortem** in Telegram (`status`, `duration`, `topics N/M`) after topic-delegate jobs
- `cron.state.json` `lastResult` — surfaced in `/status` and `gateway status`
- `deploy/PERSONAL-OPS.md` and `deploy/backup-personal.sh` for personal prod runbook
- **`csagent cron qa`** + `deploy/DIGEST-QA.md` — automated digest QA checklist
- Telegram **QA alert** after topic-delegate digest when run OK but QA FAIL (`qaOk` in `/status`)
- **Morning digest QA** launchd (08:00) + `cron qa --morning --alert`
- **H2:** digest follow-up aliases aligned with 5 topics; last digest snippet in follow-up turns; `/help` hints
- launchd **`ai.csagent.backup-weekly`** — Sunday 05:00 backup via `backup-personal.sh`
- **Cron from chat:** MCP `cron_propose` + `/schedule approve` (path 2); slash `/schedule add|list|remove|…` (path 1 fallback)
- Skill **`cron-ops`**, MCP server **`csagent-cron`** (gateway with `allowedChatIds` only)
- User cron jobs: `user-*` prefix, max 10, protected system job ids

## [0.1.1] - 2026-05-29

### Fixed

- **Postgres TUI:** shared connection pool with refcount — no more `Called end on pool more than once` when switching sessions
- **TUI tab bar:** stable slot order across switches; `Tab` / `←→` / `1`–`5` use visible tabs, not DB sort order
- **bootSession:** serialized session switches to avoid races

### Added

- `deploy/prod-check.sh` — personal prod pass (`doctor`, `gateway status`, `cron list`, launchd)

## [0.1.0] - 2026-05-29

### Added

- Local-first personal agent on Cursor TypeScript SDK (CLI, Ink TUI, cron, gateway)
- Built-in MCP servers: `csagent-memory`, `csagent-browser` (stealth Chromium)
- Skills: `memory-ops`, `browser-ops`, `obsidian-ops`
- Telegram / webhook gateway with slash catalog, pairing, digest follow-ups
- Cron jobs with prompt guard, topic delegates (5 + synthesizer) for daily digests
- TUI session tab bar: switch with `1`–`5`, `Tab` / `Shift+Tab`, `←`/`→` (empty input), `Ctrl+[` / `Ctrl+]`
- TUI `/delegate` with inject into parent session; Telegram `/delegate <prompt>` with session inject
- Postgres store option, `store migrate`, encrypted credentials (pgcrypto)
- Session search, memory facts, `import-md`, silo alignment in doctor
- **265** automated tests

### Notes

- CLI command: **`csagent`** (npm package name remains `cursor-agent` — see README naming collision)
- Requires Node.js ≥ 20 and a Cursor API key
- Cloud runtime (`runtime: cloud`) is gated but not implemented yet (issue 016)

[0.1.1]: https://github.com/niksh06/csagent/releases/tag/v0.1.1
[0.1.0]: https://github.com/niksh06/csagent/releases/tag/v0.1.0
