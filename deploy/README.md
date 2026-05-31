# csagent macOS deployment (Variant A)

Hermes-style home: **`~/.csagent`**. Code in **`~/.csagent/csagent`**, runtime in **`~/.csagent/.agent`**.

TParser — отдельный проект; для интеграции с его API настройте cron/job вручную (см. `Reports/projects/tparser-csagent-obsidian-telegram-setup.md`).

## Layout

```
~/.csagent/
  csagent.env          # CSAGENT_HOME, CSAGENT_ROOT
  logs/                # launchd stdout/stderr
  .agent/              # credentials, gateway, cron, sqlite, memory
  csagent/             # install copy (synced from repo by setup-home.sh)
```

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

Logs: `~/.csagent/logs/{gateway,cron-tick}.{log,error.log}`

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
cd "/path/to/csagent"
./scripts/csagent-run.sh doctor
```

После правок в Downloads — снова `bash deploy/setup-home.sh` (rsync → home install).

## Uninstall

```bash
bash deploy/uninstall-launchd.sh
```

## Task tracker

See [TASKS.md](./TASKS.md) for Phase 1–3 (Postgres, MemPalace MCP).
