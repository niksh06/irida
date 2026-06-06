# I-27 — Memory curator cron (optional)

**Status:** done (example only)  
**Module:** `deploy/prompts/memory-curator-weekly.prompt.txt`, `deploy/cron.jobs.example.json`

## Problem

No scheduled pass over durable memory for duplicates/stale notes.

## Solution

- Weekly prompt template (Russian, Telegram-friendly)
- Example job `memory-curator-weekly` (`enabled: false`)

## Enable in prod

Copy job into `~/.csagent/.agent/cron.jobs.json`, set `notify.chatId`, `enabled: true`.

## Verify

```bash
csagent cron run memory-curator-weekly
```
