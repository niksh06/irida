# 040 — TUI `/delegate` subagent

**Status:** done  
**Module:** `src/delegateRun.ts`, `src/tui/slash.ts`, `src/tui/App.tsx`

## Problem

Need isolated one-shot SDK run from TUI with summary only (Hermes-style delegate).

## Solution

- `runDelegate` wraps prompt, calls `runPrompt` in workdir
- TUI: `/delegate <prompt>` — shows summary in transcript

## Verify

```bash
csagent tui
# /delegate list files in src/ named gateway*
```
