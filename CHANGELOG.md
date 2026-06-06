# Changelog

All notable changes to **csagent** are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

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

[0.1.0]: https://github.com/niksh06/csagent/releases/tag/v0.1.0
