# irida — Install & Ops

Installation paths, store options, launchd, backups. Commands and config reference: [REFERENCE.md](REFERENCE.md). Deployment internals: [deploy/README.md](deploy/README.md).

## Requirements

- Node.js **>= 20** (uses built-in `node:sqlite`, `node --test`).
- A Cursor API key — **either** save locally **or** export per shell:

```bash
# Recommended: once per project (stored in .agent/credentials.json, mode 600)
printf '%s' "cursor_..." | irida auth login --stdin

# Or per-shell / CI override:
export CURSOR_API_KEY="cursor_..."   # Dashboard → Integrations
```

## Pick a store

| | **Option 1 — SQLite** | **Option 2 — Postgres** |
|---|------------------------|---------------------------|
| Complexity | Simpler, no Docker | Docker + `IRIDA_DATABASE_URL` |
| Data | `~/.irida/.agent/state.sqlite` (or `./.agent/` in a clone) | Postgres on `:5435`, sessions + memory in PG |
| Best for | Local dev, TUI/CLI, small note sets | Production home, Telegram gateway, cron, 800+ KB notes, secure notes, semantic search |
| Dev ↔ gateway parity | Only with one `IRIDA_HOME` and **no** PG URL | One PG — single source for TUI, gateway, cron |

Shared steps (both options):

```bash
git clone <repo-url> irida && cd csagent
npm install
npm run build      # compile to dist/ (also runs on npm install via prepare)
npm link           # optional: global `irida` command
```

Without `npm link`: **`npm run tui`** or **`npm run dev -- <subcommand>`** always runs from current `src/`.

Env is loaded automatically from `~/.irida/irida.env`, then repo `.env` (see `src/loadEnv.ts`).

---

## Option 1 — SQLite (simple)

Sessions, runs, and memory notes live in **SQLite** under `.agent/`. **Do not set** `IRIDA_DATABASE_URL`.

### 1a. Quick start in a repo clone

Good for hacking on the code and TUI without `~/.irida`:

```bash
cd csagent
printf '%s' "cursor_..." | npx tsx src/cli.ts auth login --stdin
npx tsx src/cli.ts doctor
npx tsx src/cli.ts tui
```

State: `./.agent/state.sqlite`, `./.agent/credentials.json`, `./.agent/memory/*.md`.

### 1b. Home install at `~/.irida` (no Postgres)

Same runtime layout as launchd, but SQLite-only store:

```bash
cd csagent
bash deploy/setup-home.sh
# Ensure ~/.irida/irida.env has NO IRIDA_DATABASE_URL line
# (setup-home.sh preserves an existing URL; remove the export manually for SQLite)

printf '%s' "cursor_..." | ~/.irida/csagent/scripts/csagent-run.sh auth login --stdin
~/.irida/csagent/scripts/csagent-run.sh doctor
~/.irida/csagent/scripts/csagent-run.sh tui
```

Optional Telegram gateway + cron (macOS):

```bash
# TELEGRAM_BOT_TOKEN in irida.env or: auth telegram login --stdin
cp deploy/gateway.json.example ~/.irida/.agent/gateway.json   # edit allowedChatIds
bash ~/.irida/csagent/deploy/install-launchd.sh
```

Verify: `launchctl list | grep csagent`, logs in `~/.irida/logs/`.

---

## Option 2 — Postgres (full)

**Sessions, runs, and memory** in Postgres — best for **Telegram gateway + cron** with one store for all processes. Required for **secure notes** (pgcrypto) and **semantic search** (pgvector). Technology reference KB stays on disk — skill **`kb-ops`**.

### 2.1. Postgres in Docker

From the repo clone (default port **5435**, avoids TParser on :5433):

```bash
cd csagent
docker compose -f deploy/docker-compose.csagent-postgres.yml up -d
docker compose -f deploy/docker-compose.csagent-postgres.yml ps   # healthy
```

### 2.2. Home + env

```bash
bash deploy/setup-home.sh
```

In `~/.irida/irida.env`, set (or uncomment after `setup-home`):

```bash
export IRIDA_DATABASE_URL="postgresql://csagent:csagent@127.0.0.1:5435/csagent"
export IRIDA_SECRETS_KEY="..."   # pgcrypto key for credentials + secure notes
# export IRIDA_LOG=1             # optional: chat/cron diagnostics
```

Re-run launchd install if services already exist — plists pick up env from `install-launchd.sh`:

```bash
printf '%s' "cursor_..." | ~/.irida/csagent/scripts/csagent-run.sh auth login --stdin
~/.irida/csagent/scripts/csagent-run.sh doctor   # should report postgres store
bash ~/.irida/csagent/deploy/install-launchd.sh
```

Migrations (`deploy/postgres/migrations/*.sql`) run on first connect.

### 2.2a. Postgres resilience / Docker self-heal (I-112)

The prod host runs Postgres under Docker Desktop, which can die on long uptime
without a reboot. When it does, the gateway long-poll stays alive but every turn
fails on `ECONNREFUSED 127.0.0.1:5435` (a silent outage). Tooling to handle it:

```bash
# Idempotent self-heal: starts Docker Desktop + the container if needed, waits
# for pg_isready. Fast exit when already healthy. Wire into cron or run by hand.
bash deploy/scripts/ensure-postgres.sh
```

- **`gateway status`** now FAILs with a `store (postgres)` line when PG is down,
  and the gateway replies "Store temporarily unavailable" instead of going silent.
- **`prod-check.sh`** runs `ensure-postgres.sh` first, so a down store self-heals
  before the rest of the checks.
- **`csagent-watchdog.sh`** (cron, every ~30 min → Telegram) now reports a down
  Docker daemon / container as a problem — early warning for this exact failure.
- **Gateway auto-ensures the store on (re)start** via
  `deploy/scripts/gateway-launch.sh` (the launchd plist now points at it). This
  takes effect after a **re-install**: `bash deploy/install-launchd.sh`.
- Durable fix for repeated Docker crashes: **reboot the Mac mini** (clears the
  Docker Desktop VM leak).

### 2.3. Technology knowledge base (file)

Clone or sync under `~/.irida/knowledge-space` (git). Agents use skill **`kb-ops`** — Grep/Read `docs/{domain}/*.md`; update with `git pull`. **Do not** import into Postgres for prod gateway.

```bash
git -C ~/.irida/knowledge-space pull --ff-only
```

Optional in `~/.irida/irida.env`: `export IRIDA_KB_ROOT="$IRIDA_HOME/knowledge-space"`. Enable `kb-ops` in `gateway.json` skills (see `deploy/gateway.json.example`).

Cron (TParser **daily** digest at `59 23 * * *`): copy `deploy/cron.jobs.example.json` → `~/.irida/.agent/cron.jobs.json`, set `notify.chatId` and `cwd` to TParser. See [deploy/README.md](deploy/README.md).

### 2.4. Postgres backup

```bash
docker compose -f deploy/docker-compose.csagent-postgres.yml exec -T csagent-postgres \
  pg_dump -U irida -Fc irida > ~/backups/csagent-$(date +%Y%m%d).dump
```

Weekly launchd backup: `ai.csagent.backup-weekly` (Sun 05:00) via `deploy/backup-personal.sh`.

---

## Switching SQLite ↔ Postgres

1. Stop gateway/cron: `bash deploy/uninstall-launchd.sh` (or skip launchd).
2. **SQLite → Postgres:** start the container, add `IRIDA_DATABASE_URL`, run `doctor`, then `irida store migrate` (sessions/runs/memory — idempotent, re-run safe).
3. **Postgres → SQLite:** remove or comment `IRIDA_DATABASE_URL` in `irida.env`, restart processes — back to `~/.irida/.agent/state.sqlite` (empty or a leftover file).

After changing store: `bash deploy/setup-home.sh` and `install-launchd.sh` if you use launchd.

## Launchd services (macOS)

| Service | Role | Schedule |
|---------|------|----------|
| `ai.csagent.gateway` | Telegram long-poll | always (KeepAlive; gateway exits non-zero on `uncaughtException` → restart) |
| `ai.csagent.cron-tick` | `irida cron tick` | every 300s |
| `ai.csagent.backup-weekly` | `backup-personal.sh` | Sun 05:00 |

Env injected into plists from `~/.irida/irida.env` by `install-launchd.sh`: `IRIDA_DATABASE_URL`, `IRIDA_SECRETS_KEY`, optional `OBSIDIAN_VAULT_PATH`.

Health: `irida gateway status` (launchd, logs, cron last results, 24h run metrics) or Telegram `/status`.

## Secrets: corruption protection (postmortem 2026-06-12)

Defense in depth after the "bot silent, 6-char token in PG" incident:

1. **Write path:** `auth login` refuses values that fail format checks (truncated stdin, empty env).
2. **History:** every overwrite of `credential_secrets` archives the previous ciphertext. `irida auth history` lists versions (length + format verdict, never values); `irida auth restore <id>` rolls back. A dev clone pointed at prod PG can no longer destroy a token irreversibly.
3. **Read path self-heal:** if the PG value fails format checks but the file copy is valid, the valid value is used and a re-save hint is logged.
4. **Gateway fail-fast:** `gateway run` refuses to start with a malformed bot token (one clear error instead of hundreds of poll `Not Found`).

## Deploy checklist (prod)

```bash
cd /path/to/csagent-clone
npm test && npm run build && npm run pack:check
bash deploy/setup-home.sh                                  # never copies credentials.json
~/.irida/csagent/scripts/csagent-run.sh doctor           # MUST: format ok + API probe
~/.irida/csagent/scripts/csagent-run.sh auth status
bash ~/.irida/csagent/deploy/install-launchd.sh
~/.irida/csagent/scripts/csagent-run.sh gateway status
tail -20 ~/.irida/logs/gateway.error.log                 # no "Not Found"
```

Never run `auth login` from a dev clone with `IRIDA_DATABASE_URL` pointing at prod — and if it happens, `auth history` has the rollback.
