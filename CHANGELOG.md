# Changelog

All notable changes to **csagent** are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed (audit 2026-06-10)

- **Telegram long replies** — rich `sendRichMessage` failure now cascades to 4096 multipart HTML/plain; outbox auto-downgrades to plain after `message is too long` (post-mortem 2026-06-13)
- **Outbox observability** (I-50) — `gateway status` / `/status` row `outbox`: pending count, oldest age, next retry; FAIL when oldest > 5 min
- **Outbox user ack** (I-51) — plain «Ответ готов, доставляю частями…» when reply parks to outbox (gateway + cron notify)
- **Doctor morning-alert** — await async handler in CLI so launchd receives real exit code (not a Promise)
- **Gateway live resume** — skip skills/`onStart` reinjection when SDK agent resumes live (gateway restart no longer sends ~10 KB preamble on first turn; transcript replay unchanged)
- **Digest QA length** — max body check raised to 12k chars (real digests ~8–9k were false morning FAIL)
- **setup-home** — skip `.agent` migrate when prod state already exists (I-38 follow-up)
- **Prod cron guard** (I-38) — `saveCronJobs` validates before write, timestamped `.bak` on overwrite, test-run block on `CSAGENT_HOME/.agent`; `gateway status` FAIL on invalid jobs; doctor suggests restore from latest backup; morning launchd `ai.csagent.prod-check-morning` (08:05) + `doctor morning-alert` → Telegram on cron health FAIL

### Added

- **Turn context preTurn** (I-52) — `memory.preTurn`: `ADVICE:`/`DO:`/`DEBUG:`/`SYNC:` prefix parsing, optional profile excerpt from a named note; profile skipped on live SDK resume; ordering profile+mode → autoRag → task
- **`memory_fact_invalidate` MCP** (I-53) — invalidate by `fact_id` or subject/predicate/object scope; `queryFacts` object filter
- **Introspection profile patches** (I-54) — skill + cron prompt require User/Agent profile patch proposal sections when communication friction; template `deploy/prompts/introspection-weekly.template.md`
- **autoRag conservative pilot** (I-55) — `deploy/agent.config.example.json` reference config; `CSAGENT_LOG=1` one-line `autoRag hits=N chars=M notes=…`; doctor warns on `meta` wing; pilot runbook in `deploy/PERSONAL-OPS.md` (prod stays `enabled: false` until sign-off)
- **Cron context artifacts** (I-40, Wave C1a) — successful runs with output write `.agent/cron.context/{jobId}.json` (redacted, 256 KiB cap); foundation for `contextFrom` (I-41)
- **Cron:** double-fire race (slot claimed before run), atomic state/jobs writes, vixie `*/N` anchor for dom/month, DOM-or-DOW semantics, oldest-missed-slot catch-up, per-job `graceMinutes` (daily digest after sleep), cross-process tick lock, webhook notify HTTP status check
- **Chat engine:** dead agent handle after failed rotation (+ next-turn recovery), idle refresh no longer consumes error-retry budget or re-fires, failed attempts recorded, partial output surfaced on exception, replay prefix no longer duplicated
- **Telegram gateway:** per-chat queues (one slow turn no longer blocks other chats), reply delivery retry, drain on stop before closing sessions, generic error text to chat (details in log), `uncaughtException` exits for launchd restart
- **Store/memory:** `store migrate` copies memory notes+facts (was sessions/runs only) and is idempotent, redaction on list previews and silo align, `markPostSeen` dedup, `importHappyinKb` idempotent facts, WAL+busy_timeout on shared sqlite, file-first note mirror
- **Gateway auth:** webhook honors `pairing.approved` (same model as Telegram); safety gate now checks composed prompt (`@file`/`@memory` content)

### Added

- **Unified slash registry** (Wave C2) — `src/slashRegistry.ts` is the single catalog for TUI `/help`, gateway routing, and Telegram `setMyCommands`; `slashCatalog.ts` and `gatewaySlash.ts` derive from it
- **Session ingest → episodic memory** (P3-2, Wave B) — recent sessions upserted as FTS-searchable notes in wing `episodic` (`ep.<sessionId>`); idempotent on `session.updated_at`; `csagent memory ingest-sessions`, cron builtin `session-ingest`
- **Auto-RAG** (Wave B) — optional `memory.autoRag` in `agent.config.json`: silent top-k `memory_search` before each turn (FTS or semantic); injected under "Relevant memory (retrieved for this message)"
- **Introspection weekly cron** (Wave B1) — skill `introspection-ops` + example job reading `runs.jsonl` and episodic notes → proposal note only (no auto-merge)
- **Secret corruption protection** (postmortem 2026-06-12) — overwrite history for `credential_secrets` (`auth history` / `auth restore <id>`), read-path self-heal (valid file beats corrupt PG value, with re-save hint), gateway fail-fast on malformed bot token; migration `009_credentials_history.sql`
- **Skill `profile-ops`** — loads `user-profile.niksh` / `agent-profile.composer` from csagent-memory (profiles were notes, the skill file never existed)
- **Cron wake-gate** (`gateScript`, borrowed from hermes-evolution) — cheap pre-script can skip the SDK run entirely (`{"wakeAgent": false}`): no tokens when there is nothing to do; fail-open on gate errors
- **Cron script jobs** (`script`) — deterministic shell tasks with zero SDK: stdout → Telegram notify, empty stdout → silent; example watchdog `deploy/scripts/csagent-watchdog.sh`
- **Cron `catchUp: "skip"`** — stale slots dropped instead of caught up (late briefings)
- **Doctor remediation** — failed checks print `↳ fix:` copy-paste commands (CLI + TUI)
- **Semantic memory search** (I-36) — local Ollama embeddings (`nomic-embed-text`, 768d) + pgvector hnsw: `memory search --semantic`, `memory reindex-embeddings`, MCP `memory_search semantic:true` (FTS fallback); embed-on-save fail-soft; secure notes never embedded; migration `008_memory_vector.sql`
- **Docs split** (I-32) — README is now a 110-line pitch+quickstart; install/ops → `OPS.md`, full reference → `REFERENCE.md`; npm tarball ships both + `deploy/` + `skills/`
- **Secure memory notes** (I-20) — `--wing secure` (Postgres): body pgcrypto-encrypted at rest, decrypt only via `memory show`/`memory_get`, masked in list/search, no `.md` mirror; sqlite refuses; migration `007_memory_secure.sql`
- **Telegram outbound queue** (I-31) — failed deliveries (replies, cron digest) park in `gateway.outbox.json`; poll loop drains with backoff 30s→1h, caps 20 attempts / 48h / 100 entries
- **Run metrics** (I-33) — `gateway status` / Telegram `/status` row `runs 24h`: count, error rate, p50/p95 duration, token totals (aggregated from `runs.jsonl`, no DB migration)
- **TUI `/find <text>`** (R3-4) — transcript search, reverse-i-search UX: first hit = newest match, repeat `/find` walks older, wraps; case-insensitive
- **Structured run log** (I-19) — every recorded run appends to `<stateDir>/logs/runs.jsonl` (id, status, duration, model, tokens; no previews); rotation at 5MB; `CSAGENT_RUN_LOG=0` disables
- **Telegram HTML formatting** (I-37) — replies and digest render `**bold**`, `` `code` ``, fences, links via HTML parse_mode; plain-text fallback on parse errors
- **Telegram tool progress via editMessage** (I-37) — one self-updating message per turn instead of message-per-tool (rate-limited 1.5s)
- **Pairing rate-limit** (I-35) — pending codes: cap 20, 24h TTL, code reuse per chat
- **pgcrypto spec** (I-20) — `issues/I-20-pgcrypto-notes-facts.md`, Option A (`secure` wing), awaits sign-off
- **Roadmap + issue tracker:** `docs/ROADMAP.md` (R1–R4), issues I-31…I-37 (outbound queue, packaging, metrics, retention, pairing rate-limit, pgvector, telegram markdown)
- Per-job **`graceMinutes`** in cron jobs — catch missed slots after machine sleep (daily digest)
- Cron builtin **`session-export`** (I-12) — daily transcripts to `Reports/sessions/YYYY-MM-DD/`
- **`tui.log`** (I-17) — `CSAGENT_LOG=1` diagnostics from TUI go to `<stateDir>/tui.log`, not stdout
- TUI **rotate pending state** (I-13) — `onAgentRotating` hook shows "reinitializing agent…" during rotation
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
- **`csagent memory audit`** — notes/facts/silo checks; optional `--links` URL probe; saves `.agent/memory-audit.last.json`

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
