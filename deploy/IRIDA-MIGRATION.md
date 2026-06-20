# Irida prod migration runbook (manual)

> Rename `csagent` → `irida` on the prod host (Mac mini). **Run by hand, in a quiet
> window.** The code is backward-compatible (the env shim reads `CSAGENT_*` and
> `~/.csagent` as fallbacks), so you can migrate incrementally and roll back.
> Do **not** delete `~/.csagent` until everything is verified.

Prereqs: on the dev box, `git pull` the rename branch and `npm run build`. The prod
install is `~/.csagent/csagent` (per ops notes) — adjust paths to your layout.

---

## 0. Snapshot (rollback safety)

```sh
launchctl print gui/$(id -u) | rg 'ai\.(csagent|irida)' || true   # what's loaded
cp -a ~/.csagent ~/.csagent.bak-$(date +%Y%m%d)                    # backup state
```

## 1. Stop background services (avoid dual services / writes mid-migration)

```sh
launchctl bootout gui/$(id -u)/ai.csagent.gateway   2>/dev/null || true
launchctl bootout gui/$(id -u)/ai.csagent.cron-tick 2>/dev/null || true
# or: csagent background pause "irida migration"
```

## 2. Migrate the home dir (copy, don't move blindly)

The shim resolves `IRIDA_HOME` → legacy `CSAGENT_HOME`, and loadEnv prefers
`~/.irida/irida.env` over `~/.csagent/csagent.env`. Two options:

- **Minimal (shim only):** keep `~/.csagent` and `CSAGENT_*` — nothing to do; the
  new binary reads the old state. Adopt the name later.
- **Full adopt:**
  ```sh
  cp -a ~/.csagent ~/.irida
  # env file: rename + re-prefix (legacy names still work, but go clean)
  sed 's/^CSAGENT_/IRIDA_/' ~/.csagent/csagent.env > ~/.irida/irida.env
  chmod 600 ~/.irida/irida.env
  ```

## 3. Secrets

`secretsKey()` reads `IRIDA_SECRETS_KEY` then legacy `CSAGENT_SECRETS_KEY`; the
Postgres credential store (pgcrypto) is unchanged (same DB, same passphrase). So
keeping the old key value works. If you re-prefixed the env file in step 2, the key
is now `IRIDA_SECRETS_KEY` — same value, so pgcrypto still decrypts.

## 4. launchd relabel (new labels, point at `irida`)

Create `ai.irida.gateway.plist` / `ai.irida.cron-tick.plist` from the existing
`deploy/launchd/ai.csagent.*.plist`, changing:

- `Label` → `ai.irida.gateway` / `ai.irida.cron-tick`
- the program path → `…/scripts/irida.mjs` (or the global `irida` bin)
- `IRIDA_HOME` (or keep `CSAGENT_HOME`) in `EnvironmentVariables`

Then swap (old out, new in — never both):

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.irida.gateway.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.irida.cron-tick.plist
launchctl print gui/$(id -u) | rg 'ai\.(csagent|irida)'   # confirm only ai.irida.* loaded
```

## 5. Verify

```sh
irida doctor                       # engine/credential checks green
irida gateway status               # store reachable, one engine line
irida run "say IRIDA_OK"           # smoke
launchctl print gui/$(id -u) | rg -c 'ai\.csagent'   # expect 0 (no dup services)
```

## 6. Cleanup (only after a few green days)

```sh
rm ~/Library/LaunchAgents/ai.csagent.*.plist
# remove the `csagent` deprecated bin alias once muscle memory adjusts
rm -rf ~/.csagent ~/.csagent.bak-*    # LAST — after confirming ~/.irida is canonical
```

---

## Rollback

If anything misbehaves: bootout `ai.irida.*`, bootstrap the old `ai.csagent.*`
plists, and the code keeps reading `~/.csagent` + `CSAGENT_*` unchanged. The backup
from step 0 is your safety net.
