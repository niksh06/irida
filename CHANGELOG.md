# Changelog

All notable changes to **csagent** are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

- **Memory audit backlog (Wave F)** — `Reports/analysis/memory-audit-improvements-2026-06-16.md`; issues I-69…I-82 (P0–P2 hygiene/retrieval/eval)

### Fixed

- **TUI thinking leak** — pre-turn `thinking…: waiting for model` no longer injects into the assistant bubble (ActivityBar only); streaming deltas strip stale tool-progress placeholders
- **Gateway skills resolution** — `listSkills` / `loadSkill` fall back to `IRIDA_ROOT/skills` when `IRIDA_HOME/skills` is missing (launchd layout: home state + repo checkout)
- **Doctor skills clarity** — `skills root` check with absolute path; gateway/threat scan details cite resolved directory; removed redundant `IRIDA_ROOT skills` check; `irida skills list` prints skills root
- **Gateway Telegram inbound silent (I-84)** — `TELEGRAM_GATEWAY_ALLOWED_UPDATES` on every `getUpdates` (Bot API global filter had been narrowed to `channel_post` only); short poll (`timeout=0`); persisted poll offset; ack after handle; parse `/cmd@BotUsername` in groups
- **Gateway test config isolation** — `writeExampleGatewayConfig` writes under test `dir/.agent` only (no IRIDA_HOME bleed)
- **Telegram allowed_updates health (I-83)** — `doctor` + `gateway status` probe `getWebhookInfo`; poll batch logs update types (I-87)
- **Memory retrieval router (I-74)** — routing table in `memory-ops`; MCP `memory_search` defaults `hybrid: true` when `memory.embeddings.enabled`
- **Hybrid memory search (I-72)** — Postgres `searchNotesHybrid` RRF merge of FTS + vector; CLI `--hybrid`; config `memory.search.hybridWeights`; FTS fallback when embedder down
- **MCP wing filters (I-75)** — `memory_search` / CLI `--wing` allow-list overrides default exclude for targeted ops retrieval
- **Memory search golden eval (I-78)** — `eval/cases/memory-search-smoke` fixture queries; `npm run eval`
- **kb-ops skill** — file KB at `$IRIDA_HOME/knowledge-space` (git pull); tech reference off Postgres; removed `happyin-kb-weekly` cron example
- **Memory governance doc** — `docs/MEMORY-GOVERNANCE.md`: files vs Postgres vs embeddings, OKF tier policy, LLM wiki + Obsidian CLI, periodic review checklist
- **Run log metadata (I-68)** — `logs/runs.jsonl` fields `channel`, `cron_job`, `is_test`; cron/chat/run paths populate them; session-ingest skips test temp cwd; doctor warns on null tokens; gateway status prod-only metrics
- **Memory retrieval model doc (I-67)** — REFERENCE «When memory is retrieved» (preTurn / onStart / autoRag / MCP layers); `memory-ops` skill; prod `csagent-index` wings + archive search
- **Cursor lesson distill (I-65)** — wing `cursor-lesson`; `memory distill-cursor` queue; backfill + delta baseline; cron jobs; HITL proposals only
- **Cursor lesson map-reduce orchestrator (I-65b)** — `memory distill-cursor --run [--backfill] [--parallel N]`; chunk split + merge; subagents pinned to `composer-2.5-fast`; `--dry-run`
- **Cursor mine `--all` + daily cron** — `memory mine-cursor --all` scans every IDE transcript; skips unchanged files by stored mtime/hash; re-imports when jsonl mtime advances; cron builtin `cursor-mine` (example job `cursor-mine-daily` at `15 0 * * *`); strips NUL bytes for Postgres UTF-8
- **Memory search exclude archive** (I-62) — default FTS/semantic skip wings `cursor-ide` and `secure`; MCP `includeArchive`; CLI `--include-archive`; embed/reindex skip `cursor-ide`
- **OKF memory format** — YAML frontmatter ([Open Knowledge Format v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)) for cursor-lesson playbooks; `memory okf audit|migrate-lessons|backfill-lineage|repair-titles|strip-legacy-meta|promote|export-review|export-bundle|purge-*`; `export-bundle` prunes stale markdown orphans; canonical gateway playbook `lesson.gateway-idle-rotation`; distill queue upsert + optional facts
- **Gateway skills** — `deploy/gateway.json.example` adds `kb-ops` + `tool-economy` alongside `memory-ops`
- **tool-economy skill** — token/tool routing playbook in `skills/tool-economy.md`

### Added

- **Gateway allowlist in Postgres (I-96)** — when `IRIDA_DATABASE_URL` + `IRIDA_SECRETS_KEY`: chat IDs stored encrypted in `gateway_allowed_chats` (pgcrypto); auto-migrate from `gateway.json` on gateway start; SQLite path unchanged (`allowedChatIds` in file)
- **cursor-lesson paired eval (I-79)** — `eval/cases/cursor-lesson-paired`; `irida memory lesson-eval validate|list|sheet|record|summary`; facts `cursor_lesson_eval`
- **Reddit digest cron (I-77)** — `reddit-rss-fetch` script + `reddit-digest-daily` SDK job; `reddit-digest-YYYY-MM-DD` wing `reddit`; fact `reddit_digest last_run`
- **Archive purge CLI (I-80)** — `irida memory purge-archive` TTL 180d dry-run; `--require-lesson` gated delete
- **gateway-ops skill (I-85)** — Telegram Bot API guardrails; inbound silent / `allowed_updates` playbook
- **Gateway post-deploy smoke (I-88)** — `deploy/gateway-smoke.sh` (allowed_updates + launchd + poll log); wired into `prod-check.sh`
- **Desktop pet (I-97)** — **Wisp** mascot in `irida tui` (hand-drawn Unicode, multi-color); `irida pet status` for optional snapshot

### Changed

- **Wisp pet polish (I-97)** — all states now animate (idle blink, sleep breathing/zZz, sad teardrop, happy sparkle-pop) on uniform 5-line frames (no vertical jump); single-eye image enforced across every state; `working` reflects the active tool in the label and a top "thought" glyph (reading `▤` / writing `✎` / searching `⌕` / running `›_` / connecting `⇄`) while the tail keeps its ⚡/≋ energy pulse; `npm run pet` (`scripts/pet-preview.mts`) to eyeball frames standalone
- **Packaging (I-32)** — `npm run pack:check`; README test count; OPS develop checklist
- **Episodic search exclude (I-73)** — wing `episodic` omitted from default FTS/semantic; CLI `--include-episodic`; MCP `includeEpisodic`
- **TParser digest dedup** — stop writing `seen_post` memory facts (~15–20k/week); window-only dedup in prompts; removed cron `memoryFactsSubject` preamble; `irida memory fact purge-seen-post` to drop legacy rows
- **cursor-ide ingest cap (D2)** — truncate archive body at 200 KB; full jsonl on disk; `memory audit` labels curated vs archive
- **Embeddings backfill** — enable `memory.embeddings` + `memory reindex-embeddings` for episodic/lesson wings (not archive); `setup-home.sh` no longer overwrites prod `agent.config.json`

### Fixed

- **Run log tokens (I-33)** — capture usage from SDK `onDelta` `turn-ended` updates (not emitted on `run.stream()`); `runs.jsonl` input/output tokens populated for gateway/cron chat turns
- **Cursor-ide archive hash** — `withHashComment` stores hash inside HTML comment; `resolveArchiveContentHash` handles malformed legacy headers
- **Cursor mine skip logic** — `noteNeedsUpdate` compares embedded header hash (not hash of body including comment); fix `withHashComment` mtime regex so hash is actually written
- **OKF legacy HTML meta** — `strip-legacy-meta` removes stale `<!-- irida cursor-lesson … -->` when YAML frontmatter is source of truth

## [0.2.0] - 2026-06-13

### Fixed (audit 2026-06-10)

- **Telegram long replies** — rich `sendRichMessage` failure now cascades to 4096 multipart HTML/plain; outbox auto-downgrades to plain after `message is too long` (post-mortem 2026-06-13)
- **Outbox observability** (I-50) — `gateway status` / `/status` row `outbox`: pending count, oldest age, next retry; FAIL when oldest > 5 min
- **Outbox user ack** (I-51) — plain «Ответ готов, доставляю частями…» when reply parks to outbox (gateway + cron notify)
- **preTurn profile** — excerpt only on first composed turn per session; flag consumed before safety gate (blocked first turns no longer re-inject)
- **Doctor morning-alert** — await async handler in CLI so launchd receives real exit code (not a Promise)
- **Gateway live resume** — skip skills/`onStart` reinjection when SDK agent resumes live (gateway restart no longer sends ~10 KB preamble on first turn; transcript replay unchanged)
- **Digest QA length** — max body check raised to 12k chars (real digests ~8–9k were false morning FAIL)
- **setup-home** — skip `.agent` migrate when prod state already exists (I-38 follow-up)
- **Prod cron guard** (I-38) — `saveCronJobs` validates before write, timestamped `.bak` on overwrite, test-run block on `IRIDA_HOME/.agent`; `gateway status` FAIL on invalid jobs; doctor suggests restore from latest backup; morning launchd `ai.csagent.prod-check-morning` (08:05) + `doctor morning-alert` → Telegram on cron health FAIL

### Added

- **Turn context preTurn** (I-52) — `memory.preTurn`: `ADVICE:`/`DO:`/`DEBUG:`/`SYNC:` prefix parsing, optional profile excerpt from a named note; profile skipped on live SDK resume; ordering profile+mode → autoRag → task
- **`memory_fact_invalidate` MCP** (I-53) — invalidate by `fact_id` or subject/predicate/object scope; `queryFacts` object filter
- **Introspection profile patches** (I-54) — skill + cron prompt require User/Agent profile patch proposal sections when communication friction; template `deploy/prompts/introspection-weekly.template.md`
- **autoRag conservative pilot** (I-55) — `deploy/agent.config.example.json` reference config; `IRIDA_LOG=1` one-line `autoRag hits=N chars=M notes=…`; doctor warns on `meta` wing; pilot runbook in `deploy/PERSONAL-OPS.md` (prod stays `enabled: false` until sign-off)
- **Digest length policy** (I-60) — synthesizer prompt targets ≤3500 chars + TL;DR first; `cron qa` WARN tier for 3501–12000 (FAIL unchanged at >12k)
- **Cron context artifacts** (I-40, Wave C1a) — successful runs with output write `.agent/cron.context/{jobId}.json` (redacted, 256 KiB cap); foundation for `contextFrom` (I-41)
- **Cron contextFrom pipeline** (I-41, I-42) — job field `contextFrom` + `{{context_from}}` in prompts; tick topological order; skip downstream when upstream fails; example `pipeline-source` / `pipeline-synth` in `deploy/cron.jobs.example.json`
- **Action transcript + `/undo`** (I-44, I-45) — append-only `.agent/action.transcript.jsonl` for reversible memory delete and cron user-remove; `/undo` in TUI + Telegram
- **Skill threat scan** (I-46) — shared `promptThreatScan` patterns on skill load; doctor row `skills threat scan`
- **Turn hooks** (I-47) — optional `hooks.preTurn` / `hooks.postTurn` script config; preTurn exit 2 denies turn; stdout appended (4 KiB cap)
- **Eval battery** (I-49) — `eval/manifest.json` + `irida eval run`; verify scripts without live SDK in CI
- **Shared SQLite handle** (R2-6) — session + memory stores ref-count one `DatabaseSync` per `state.sqlite` (replaces dual-handle WAL workaround)
- **Cursor IDE transcript mining** (P3-3 / R4-4) — `irida memory mine-cursor` ingests `~/.cursor/projects/*/agent-transcripts/*.jsonl` into wing `cursor-ide`
- **Cron:** double-fire race (slot claimed before run), atomic state/jobs writes, vixie `*/N` anchor for dom/month, DOM-or-DOW semantics, oldest-missed-slot catch-up, per-job `graceMinutes` (daily digest after sleep), cross-process tick lock, webhook notify HTTP status check
- **Chat engine:** dead agent handle after failed rotation (+ next-turn recovery), idle refresh no longer consumes error-retry budget or re-fires, failed attempts recorded, partial output surfaced on exception, replay prefix no longer duplicated
- **Telegram gateway:** per-chat queues (one slow turn no longer blocks other chats), reply delivery retry, drain on stop before closing sessions, generic error text to chat (details in log), `uncaughtException` exits for launchd restart
- **Store/memory:** `store migrate` copies memory notes+facts (was sessions/runs only) and is idempotent, redaction on list previews and silo align, `markPostSeen` dedup, `importHappyinKb` idempotent facts, WAL+busy_timeout on shared sqlite, file-first note mirror
- **Gateway auth:** webhook honors `pairing.approved` (same model as Telegram); safety gate now checks composed prompt (`@file`/`@memory` content)

### Added

- **Unified slash registry** (Wave C2) — `src/slashRegistry.ts` is the single catalog for TUI `/help`, gateway routing, and Telegram `setMyCommands`; `slashCatalog.ts` and `gatewaySlash.ts` derive from it
- **Session ingest → episodic memory** (P3-2, Wave B) — recent sessions upserted as FTS-searchable notes in wing `episodic` (`ep.<sessionId>`); idempotent on `session.updated_at`; `irida memory ingest-sessions`, cron builtin `session-ingest`
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
- **Structured run log** (I-19) — every recorded run appends to `<stateDir>/logs/runs.jsonl` (id, status, duration, model, tokens; no previews); rotation at 5MB; `IRIDA_RUN_LOG=0` disables
- **Telegram HTML formatting** (I-37) — replies and digest render `**bold**`, `` `code` ``, fences, links via HTML parse_mode; plain-text fallback on parse errors
- **Telegram tool progress via editMessage** (I-37) — one self-updating message per turn instead of message-per-tool (rate-limited 1.5s)
- **Pairing rate-limit** (I-35) — pending codes: cap 20, 24h TTL, code reuse per chat
- **pgcrypto spec** (I-20) — `issues/I-20-pgcrypto-notes-facts.md`, Option A (`secure` wing), awaits sign-off
- **Roadmap + issue tracker:** `docs/ROADMAP.md` (R1–R4), issues I-31…I-37 (outbound queue, packaging, metrics, retention, pairing rate-limit, pgvector, telegram markdown)
- Per-job **`graceMinutes`** in cron jobs — catch missed slots after machine sleep (daily digest)
- Cron builtin **`session-export`** (I-12) — daily transcripts to `Reports/sessions/YYYY-MM-DD/`
- **`tui.log`** (I-17) — `IRIDA_LOG=1` diagnostics from TUI go to `<stateDir>/tui.log`, not stdout
- TUI **rotate pending state** (I-13) — `onAgentRotating` hook shows "reinitializing agent…" during rotation
- Cron digest **post-mortem** in Telegram (`status`, `duration`, `topics N/M`) after topic-delegate jobs
- `cron.state.json` `lastResult` — surfaced in `/status` and `gateway status`
- `deploy/PERSONAL-OPS.md` and `deploy/backup-personal.sh` for personal prod runbook
- **`irida cron qa`** + `deploy/DIGEST-QA.md` — automated digest QA checklist
- Telegram **QA alert** after topic-delegate digest when run OK but QA FAIL (`qaOk` in `/status`)
- **Morning digest QA** launchd (08:00) + `cron qa --morning --alert`
- **H2:** digest follow-up aliases aligned with 5 topics; last digest snippet in follow-up turns; `/help` hints
- launchd **`ai.csagent.backup-weekly`** — Sunday 05:00 backup via `backup-personal.sh`
- **Cron from chat:** MCP `cron_propose` + `/schedule approve` (path 2); slash `/schedule add|list|remove|…` (path 1 fallback)
- Skill **`cron-ops`**, MCP server **`csagent-cron`** (gateway with `allowedChatIds` only)
- User cron jobs: `user-*` prefix, max 10, protected system job ids
- **`irida memory audit`** — notes/facts/silo checks; optional `--links` URL probe; saves `.agent/memory-audit.last.json`

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

- CLI command: **`irida`** (npm package name remains `cursor-agent` — see README naming collision)
- Requires Node.js ≥ 20 and a Cursor API key
- Cloud runtime (`runtime: cloud`) is gated but not implemented yet (issue 016)

[0.2.0]: https://github.com/niksh06/csagent/releases/tag/v0.2.0
[0.1.1]: https://github.com/niksh06/csagent/releases/tag/v0.1.1
[0.1.0]: https://github.com/niksh06/csagent/releases/tag/v0.1.0
