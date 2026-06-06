# 039 — Memory silo ops + doctor green

**Status:** done  
**Module:** `src/memorySiloOps.ts`, `src/memory_cmd.ts`, `src/doctorChecks.ts`

## Problem

Notes in repo `.agent/memory` and cron `cwd/.agent/memory` diverge from canonical `CSAGENT_HOME/.agent/memory`. Doctor reported FAIL.

## Solution

- `gatherMemorySilos` / `alignMemorySilos` / `siloIsAligned`
- CLI: `csagent memory align-silo [--dry-run]`
- Doctor checks alignment (not just file count)

## Verify

```bash
csagent memory align-silo --dry-run
csagent memory align-silo
csagent doctor   # memory silo OK
```
