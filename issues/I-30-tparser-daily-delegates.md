# I-30 — TParser daily digest (5 topic delegates)

**Status:** done  
**Module:** `src/tparserTopics.ts`, `src/cronTopicDigest.ts`, `deploy/prompts/tparser-daily-*.txt`

## Schedule

- **Once per day** `0 20 * * *` (20:00 local)
- Window: **24h** (`topicWindowHours`)

## Flow

1. Five `runDelegate` runs (AI/ML, AISec, InfoSec, Programming, DevOps)
2. Each subagent: fetch TParser API, filter topic, per-post structure + verdict + tg_link, optional browser for URLs
3. `runPrompt` synthesizer merges sections → one Telegram body

## Prod

`~/.csagent/.agent/cron.jobs.json` → `tparser-daily-digest`

## Verify

```bash
csagent cron list
csagent cron run tparser-daily-digest
```
