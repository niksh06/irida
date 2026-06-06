# I-29 — obsidian-ops skill (filesystem vault)

**Status:** done  
**Module:** `skills/obsidian-ops.md`, `deploy/gateway.json.example`, launchd `OBSIDIAN_VAULT_PATH`

## Problem

Tolaria MCP is read-only. User PKM lives in Obsidian vault; needs write/search via agent without Hermes fork.

## Solution

- Skill playbook: Read/Write/Grep/Glob on vault; wikilinks; split from `memory-ops`
- `OBSIDIAN_VAULT_PATH` in `csagent.env` + launchd plists
- Enable in `gateway.json` skills array

## Verify

```bash
export OBSIDIAN_VAULT_PATH="/path/to/ForNotes"
csagent run --skill obsidian-ops "list markdown files in vault root"
csagent doctor   # gateway skills includes obsidian-ops
```
