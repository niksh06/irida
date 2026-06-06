# I-24 — Cron prompt injection guard

**Status:** done  
**Module:** `src/cronPromptGuard.ts`, `src/cronEngine.ts`, `src/doctorChecks.ts`

## Problem

Cron `prompt` / `promptFile` could contain injection patterns; no doctor visibility.

## Solution

- `scanPromptText` deny patterns
- `validateCronJobPrompt` — skip job run on hit (exit 77)
- Doctor: `cron prompt guard`

## Verify

```bash
csagent doctor
csagent cron run <id>   # benign prompts pass
```
