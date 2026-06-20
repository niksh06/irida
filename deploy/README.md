# irida macOS deployment (Variant A)

Hermes-style home: **`~/.irida`**. Code in **`~/.irida/csagent`**, runtime in **`~/.irida/.agent`**.

Внутренние runbook'и (фазы, TParser cron, memory alignment): **`docs/deploy/`** — локально, не в git.

## Layout

```
~/.irida/
  irida.env          # IRIDA_HOME, IRIDA_ROOT
  logs/                # launchd stdout/stderr
  .agent/              # credentials, gateway, cron, sqlite, memory
  csagent/             # install copy (synced from repo by setup-home.sh)
    skills/            # bundled Markdown skills (canonical prod path)
    agent.config.json
    src/
```

**Skills:** live under **`$IRIDA_ROOT/skills`**, not `~/.irida/skills`. `setup-home.sh` rsyncs `skills/` from the repo into the install copy. Gateway/cron resolve them via `IRIDA_ROOT` when `IRIDA_HOME` has no local `skills/` overlay. Verify: `irida doctor` → `skills root: …/csagent/skills`.

## Prod health (personal ops)

Runbook: **[deploy/PERSONAL-OPS.md](PERSONAL-OPS.md)** (digest, backup, weekly curator).

After deploy or `setup-home.sh`:

```bash
bash ~/.irida/csagent/deploy/prod-check.sh
bash ~/.irida/csagent/deploy/backup-personal.sh   # optional snapshot
```

Manual digest smoke (before trusting 23:59 cron):

```bash
~/.irida/csagent/scripts/csagent-run.sh cron run tparser-daily-digest
```

Telegram: `/status`, `/doctor` — no laptop required.

## Quick start

```bash
# 1. Initialize home + sync code out of ~/Downloads
bash deploy/setup-home.sh

# 2. Auth (once) — writes ~/.irida/.agent/credentials.json
IRIDA_HOME=~/.irida IRIDA_ROOT=~/.irida/irida \
  ~/.irida/csagent/scripts/csagent-run.sh auth login --stdin

# 3. Doctor
~/.irida/csagent/scripts/csagent-run.sh doctor

# 4. Install launchd
bash ~/.irida/csagent/deploy/install-launchd.sh
```

## Services

| Label | Role | Interval |
|-------|------|----------|
| `ai.csagent.gateway` | Telegram long-poll | always (KeepAlive) |
| `ai.csagent.cron-tick` | `irida cron tick` | every 300s |
| `ai.csagent.backup-weekly` | `backup-personal.sh` | Sun 05:00 |
| `ai.csagent.digest-qa-morning` | `digest-qa-morning.sh` | daily 08:00 |
| `ai.csagent.prod-check-morning` | `prod-check-morning.sh` | daily 08:05 |

Logs: `~/.irida/logs/{gateway,cron-tick}.{log,error.log}`

Gateway ops (`[gateway]` info, `[chat]` traces) → **stdout** `gateway.log`. Errors (poll failures, sendTurn errors) → **stderr** `gateway.error.log`. Tail ops: `tail -f ~/.irida/logs/gateway.log`; errors: `gateway.error.log`.

## Hermes vs irida (one bot)

Same Telegram bot → **only one** long-poll process.

```bash
# Use irida (install script unloads Hermes automatically)
bash deploy/install-launchd.sh

# Switch back to Hermes
bash deploy/uninstall-launchd.sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.hermes.gateway.plist
```

## Manual run (debug)

```bash
source ~/.irida/irida.env
"$IRIDA_ROOT/scripts/csagent-run.sh" gateway run --adapter telegram
"$IRIDA_ROOT/scripts/csagent-run.sh" cron tick
```

## Global `irida` CLI

`npm link` uses `scripts/csagent.mjs`. If `npm run build` fails (EACCES on `dist/`), it **falls back to tsx** automatically.

## Dev from Downloads repo

Работать можно из клона в Downloads; для launchd нужен `setup-home.sh` (копия в `~/.irida/csagent`). Runtime всегда в `~/.irida/.agent`:

```bash
export IRIDA_HOME=~/.irida
cd /path/to/your/csagent-clone
./scripts/csagent-run.sh doctor
```

После правок в Downloads — снова `bash deploy/setup-home.sh` (rsync → home install).

## Uninstall

```bash
bash deploy/uninstall-launchd.sh
```

## Postgres (Phase 1)

Hybrid store: set `IRIDA_DATABASE_URL` in `~/.irida/irida.env`, then reinstall launchd so plists pick it up.

```bash
# Start PG (from repo clone)
docker compose -f deploy/docker-compose.csagent-postgres.yml up -d

# In ~/.irida/irida.env:
export IRIDA_DATABASE_URL="postgresql://csagent:csagent@127.0.0.1:5435/csagent"

bash deploy/setup-home.sh
bash deploy/install-launchd.sh
~/.irida/csagent/scripts/csagent-run.sh doctor
```

Without `IRIDA_DATABASE_URL` — fallback to `~/.irida/.agent/state.sqlite` (Variant A unchanged).

Migrations run automatically on first connect (`deploy/postgres/migrations/*.sql`).

### Backup

```bash
docker compose -f deploy/docker-compose.csagent-postgres.yml exec -T csagent-postgres \
  pg_dump -U irida -Fc irida > ~/backups/csagent-$(date +%Y%m%d).dump

# restore (from host, with pg client)
docker compose -f deploy/docker-compose.csagent-postgres.yml exec -T csagent-postgres \
  pg_restore -U irida -d irida --clean --if-exists < ~/backups/csagent-YYYYMMDD.dump
```

## Memory (Phase 2, MCP-first)

Default: **`memory.mcp: true`**, no `memory.onStart` — agent pulls notes via MCP tools on demand.

```bash
# First-time agent.config (also created by setup-home.sh if missing):
cp deploy/agent.config.example.json ~/.irida/csagent/agent.config.json

# Telegram: memory-ops + kb-ops in gateway.json (see deploy/gateway.json.example)
```
