# csagent macOS deployment (Variant A)

Hermes-style home: **`~/.csagent`**. Code in **`~/.csagent/csagent`**, runtime in **`~/.csagent/.agent`**.

Внутренние runbook'и (фазы, TParser cron, memory alignment): **`docs/deploy/`** — локально, не в git.

## Layout

```
~/.csagent/
  csagent.env          # CSAGENT_HOME, CSAGENT_ROOT
  logs/                # launchd stdout/stderr
  .agent/              # credentials, gateway, cron, sqlite, memory
  csagent/             # install copy (synced from repo by setup-home.sh)
```

## Prod health (personal ops)

Runbook: **[deploy/PERSONAL-OPS.md](PERSONAL-OPS.md)** (digest, backup, weekly curator).

After deploy or `setup-home.sh`:

```bash
bash ~/.csagent/csagent/deploy/prod-check.sh
bash ~/.csagent/csagent/deploy/backup-personal.sh   # optional snapshot
```

Manual digest smoke (before trusting 23:59 cron):

```bash
~/.csagent/csagent/scripts/csagent-run.sh cron run tparser-daily-digest
```

Telegram: `/status`, `/doctor` — no laptop required.

## Quick start

```bash
# 1. Initialize home + sync code out of ~/Downloads
bash deploy/setup-home.sh

# 2. Auth (once) — writes ~/.csagent/.agent/credentials.json
CSAGENT_HOME=~/.csagent CSAGENT_ROOT=~/.csagent/csagent \
  ~/.csagent/csagent/scripts/csagent-run.sh auth login --stdin

# 3. Doctor
~/.csagent/csagent/scripts/csagent-run.sh doctor

# 4. Install launchd
bash ~/.csagent/csagent/deploy/install-launchd.sh
```

## Services

| Label | Role | Interval |
|-------|------|----------|
| `ai.csagent.gateway` | Telegram long-poll | always (KeepAlive) |
| `ai.csagent.cron-tick` | `csagent cron tick` | every 300s |
| `ai.csagent.backup-weekly` | `backup-personal.sh` | Sun 05:00 |

Logs: `~/.csagent/logs/{gateway,cron-tick}.{log,error.log}`

Gateway ops (`[gateway]` info, `[chat]` traces) → **stdout** `gateway.log`. Errors (poll failures, sendTurn errors) → **stderr** `gateway.error.log`. Tail ops: `tail -f ~/.csagent/logs/gateway.log`; errors: `gateway.error.log`.

## Hermes vs csagent (one bot)

Same Telegram bot → **only one** long-poll process.

```bash
# Use csagent (install script unloads Hermes automatically)
bash deploy/install-launchd.sh

# Switch back to Hermes
bash deploy/uninstall-launchd.sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.hermes.gateway.plist
```

## Manual run (debug)

```bash
source ~/.csagent/csagent.env
"$CSAGENT_ROOT/scripts/csagent-run.sh" gateway run --adapter telegram
"$CSAGENT_ROOT/scripts/csagent-run.sh" cron tick
```

## Global `csagent` CLI

`npm link` uses `scripts/csagent.mjs`. If `npm run build` fails (EACCES on `dist/`), it **falls back to tsx** automatically.

## Dev from Downloads repo

Работать можно из клона в Downloads; для launchd нужен `setup-home.sh` (копия в `~/.csagent/csagent`). Runtime всегда в `~/.csagent/.agent`:

```bash
export CSAGENT_HOME=~/.csagent
cd /path/to/your/csagent-clone
./scripts/csagent-run.sh doctor
```

После правок в Downloads — снова `bash deploy/setup-home.sh` (rsync → home install).

## Uninstall

```bash
bash deploy/uninstall-launchd.sh
```

## Postgres (Phase 1)

Hybrid store: set `CSAGENT_DATABASE_URL` in `~/.csagent/csagent.env`, then reinstall launchd so plists pick it up.

```bash
# Start PG (from repo clone)
docker compose -f deploy/docker-compose.csagent-postgres.yml up -d

# In ~/.csagent/csagent.env:
export CSAGENT_DATABASE_URL="postgresql://csagent:csagent@127.0.0.1:5435/csagent"

bash deploy/setup-home.sh
bash deploy/install-launchd.sh
~/.csagent/csagent/scripts/csagent-run.sh doctor
```

Without `CSAGENT_DATABASE_URL` — fallback to `~/.csagent/.agent/state.sqlite` (Variant A unchanged).

Migrations run automatically on first connect (`deploy/postgres/migrations/*.sql`).

### Backup

```bash
docker compose -f deploy/docker-compose.csagent-postgres.yml exec -T csagent-postgres \
  pg_dump -U csagent -Fc csagent > ~/backups/csagent-$(date +%Y%m%d).dump

# restore (from host, with pg client)
docker compose -f deploy/docker-compose.csagent-postgres.yml exec -T csagent-postgres \
  pg_restore -U csagent -d csagent --clean --if-exists < ~/backups/csagent-YYYYMMDD.dump
```

## Memory (Phase 2, MCP-first)

Default: **`memory.mcp: true`**, no `memory.onStart` — agent pulls notes via MCP tools on demand.

```bash
# First-time agent.config (also created by setup-home.sh if missing):
cp deploy/agent.config.example.json ~/.csagent/csagent/agent.config.json

# Telegram: memory-ops skill in gateway.json (see deploy/gateway.json.example)
```
