# I-25 — Session search CLI + TUI

**Status:** done  
**Module:** `src/sessionSearch.ts`, `src/sessions_cmd.ts`, `src/tui/sessionSearch.ts`

## Problem

No quick filter for stored sessions by id/title/cwd outside TUI picker.

## Solution

- `csagent sessions search <query>`
- Gateway `/sessions [filter]` uses channel-scoped search
- TUI picker already uses `filterSessions`

## Verify

```bash
csagent sessions search tparser
# Telegram: /sessions digest
```
