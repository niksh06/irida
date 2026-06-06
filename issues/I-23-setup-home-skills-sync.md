# I-23 — setup-home / doctor skills sync

**Status:** done  
**Module:** `deploy/setup-home.sh`, `src/doctorChecks.ts`, `src/skills.ts`

## Problem

Gateway `skills` in `gateway.json` could be missing under `CSAGENT_ROOT/skills/` after dev→home sync.

## Solution

- `setup-home.sh` explicit `rsync skills/`
- Doctor: `gateway skills` + `CSAGENT_ROOT skills` checks via `skillExists`

## Verify

```bash
bash deploy/setup-home.sh
csagent doctor   # gateway skills OK
```
