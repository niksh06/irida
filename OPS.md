# csagent — Install & Ops

Installation paths, store options, launchd, backups. Commands and config reference: [REFERENCE.md](REFERENCE.md). Deployment internals: [deploy/README.md](deploy/README.md).

## Requirements

- Node.js **>= 20** (uses built-in `node:sqlite`, `node --test`).
- A Cursor API key — **either** save locally **or** export per shell:

```bash
# Recommended: once per project (stored in .agent/credentials.json, mode 600)
printf '%s' "cursor_..." | csagent auth login --stdin

# Or per-shell / CI override:
export CURSOR_API_KEY="cursor_..."   # Dashboard → Integrations
```

## Pick a store

| | **Option 1 — SQLite** | **Option 2 — Postgres** |
|---|------------------------|---------------------------|
| Complexity | Simpler, no Docker | Docker + `CSAGENT_DATABASE_URL` |
| Data | `~/.csagent/.agent/state.sqlite` (or `./.agent/` in a clone) | Postgres on `:5435`, sessions + memory in PG |
| Best for | Local dev, TUI/CLI, small note sets | Production home, Telegram gateway, cron, 800+ KB notes, secure notes, semantic search |
| Dev ↔ gateway parity | Only with one `CSAGENT_HOME` and **no** PG URL | One PG — single source for TUI, gateway, cron |

Shared steps (both options):

```bash
git clone <repo-url> csagent && cd csagent
npm install
npm run build      # compile to dist/ (also runs on npm install via prepare)
npm link           # optional: global `csagent` command
```

Without `npm link`: **`npm run tui`** or **`npm run dev -- <subcommand>`** always runs from current `src/`.

Env is loaded automatically from `~/.csagent/csagent.env`, then repo `.env` (see `src/loadEnv.ts`).

---

## Option 1 — SQLite (simple)

Sessions, runs, and memory notes live in **SQLite** under `.agent/`. **Do not set** `CSAGENT_DATABASE_URL`.

### 1a. Quick start in a repo clone

Good for hacking on the code and TUI without `~/.csagent`:

```bash
cd csagent
printf '%s' "cursor_..." | npx tsx src/cli.ts auth login --stdin
npx tsx src/cli.ts doctor
npx tsx src/cli.ts tui
```

State: `./.agent/state.sqlite`, `./.agent/credentials.json`, `./.agent/memory/*.md`.

### 1b. Home install at `~/.csagent` (no Postgres)

Same runtime layout as launchd, but SQLite-only store:

```bash
cd csagent
bash deploy/setup-home.sh
# Ensure ~/.csagent/csagent.env has NO CSAGENT_DATABASE_URL line
# (setup-home.sh preserves an existing URL; remove the export manually for SQLite)

printf '%s' "cursor_..." | ~/.csagent/csagent/scripts/csagent-run.sh auth login --stdin
~/.csagent/csagent/scripts/csagent-run.sh doctor
~/.csagent/csagent/scripts/csagent-run.sh tui
```

Optional Telegram gateway + cron (macOS):

```bash
# TELEGRAM_BOT_TOKEN in csagent.env or: auth telegram login --stdin
cp deploy/gateway.json.example ~/.csagent/.agent/gateway.json   # edit allowedChatIds
bash ~/.csagent/csagent/deploy/install-launchd.sh
```

Verify: `launchctl list | grep csagent`, logs in `~/.csagent/logs/`.

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

In `~/.csagent/csagent.env`, set (or uncomment after `setup-home`):

```bash
export CSAGENT_DATABASE_URL="postgresql://csagent:csagent@127.0.0.1:5435/csagent"
export CSAGENT_SECRETS_KEY="..."   # pgcrypto key for credentials + secure notes
# export CSAGENT_LOG=1             # optional: chat/cron diagnostics
```

Re-run launchd install if services already exist — plists pick up env from `install-launchd.sh`:

```bash
printf '%s' "cursor_..." | ~/.csagent/csagent/scripts/csagent-run.sh auth login --stdin
~/.csagent/csagent/scripts/csagent-run.sh doctor   # should report postgres store
bash ~/.csagent/csagent/deploy/install-launchd.sh
```

Migrations (`deploy/postgres/migrations/*.sql`) run on first connect.

### 2.3. Technology knowledge base (file)

Clone or sync under `~/.csagent/knowledge-space` (git). Agents use skill **`kb-ops`** — Grep/Read `docs/{domain}/*.md`; update with `git pull`. **Do not** import into Postgres for prod gateway.

```bash
git -C ~/.csagent/knowledge-space pull --ff-only
```

Optional in `~/.csagent/csagent.env`: `export CSAGENT_KB_ROOT="$CSAGENT_HOME/knowledge-space"`. Enable `kb-ops` in `gateway.json` skills (see `deploy/gateway.json.example`).

Cron (TParser **daily** digest at `59 23 * * *`): copy `deploy/cron.jobs.example.json` → `~/.csagent/.agent/cron.jobs.json`, set `notify.chatId` and `cwd` to TParser. See [deploy/README.md](deploy/README.md).

### 2.4. Postgres backup

```bash
docker compose -f deploy/docker-compose.csagent-postgres.yml exec -T csagent-postgres \
  pg_dump -U csagent -Fc csagent > ~/backups/csagent-$(date +%Y%m%d).dump
```

Weekly launchd backup: `ai.csagent.backup-weekly` (Sun 05:00) via `deploy/backup-personal.sh`.

---

## Switching SQLite ↔ Postgres

1. Stop gateway/cron: `bash deploy/uninstall-launchd.sh` (or skip launchd).
2. **SQLite → Postgres:** start the container, add `CSAGENT_DATABASE_URL`, run `doctor`, then `csagent store migrate` (sessions/runs/memory — idempotent, re-run safe).
3. **Postgres → SQLite:** remove or comment `CSAGENT_DATABASE_URL` in `csagent.env`, restart processes — back to `~/.csagent/.agent/state.sqlite` (empty or a leftover file).

After changing store: `bash deploy/setup-home.sh` and `install-launchd.sh` if you use launchd.

## Launchd services (macOS)

| Service | Role | Schedule |
|---------|------|----------|
| `ai.csagent.gateway` | Telegram long-poll | always (KeepAlive; gateway exits non-zero on `uncaughtException` → restart) |
| `ai.csagent.cron-tick` | `csagent cron tick` | every 300s |
| `ai.csagent.backup-weekly` | `backup-personal.sh` | Sun 05:00 |

Env injected into plists from `~/.csagent/csagent.env` by `install-launchd.sh`: `CSAGENT_DATABASE_URL`, `CSAGENT_SECRETS_KEY`, optional `OBSIDIAN_VAULT_PATH`.

Health: `csagent gateway status` (launchd, logs, cron last results, 24h run metrics) or Telegram `/status`.

## Secrets: corruption protection (postmortem 2026-06-12)

Defense in depth after the "bot silent, 6-char token in PG" incident:

1. **Write path:** `auth login` refuses values that fail format checks (truncated stdin, empty env).
2. **History:** every overwrite of `credential_secrets` archives the previous ciphertext. `csagent auth history` lists versions (length + format verdict, never values); `csagent auth restore <id>` rolls back. A dev clone pointed at prod PG can no longer destroy a token irreversibly.
3. **Read path self-heal:** if the PG value fails format checks but the file copy is valid, the valid value is used and a re-save hint is logged.
4. **Gateway fail-fast:** `gateway run` refuses to start with a malformed bot token (one clear error instead of hundreds of poll `Not Found`).

## Deploy checklist (prod)

```bash
cd /path/to/csagent-clone
npm test && npm run build && npm run pack:check
bash deploy/setup-home.sh                                  # never copies credentials.json
~/.csagent/csagent/scripts/csagent-run.sh doctor           # MUST: format ok + API probe
~/.csagent/csagent/scripts/csagent-run.sh auth status
bash ~/.csagent/csagent/deploy/install-launchd.sh
~/.csagent/csagent/scripts/csagent-run.sh gateway status
tail -20 ~/.csagent/logs/gateway.error.log                 # no "Not Found"
```

Never run `auth login` from a dev clone with `CSAGENT_DATABASE_URL` pointing at prod — and if it happens, `auth history` has the rollback.
