---
name: memory-ops
description: Query csagent-memory MCP before answering; save durable notes and facts on request
tags: [memory, csagent]
---

Memory is **on-demand**, not preloaded. Do not assume context contains project facts.

## Read (before answering)

When the user asks about setup, TParser, cron, past decisions, or anything that might live in memory:

1. Call `memory_search` with relevant keywords, or `memory_get` if you know the note name.
2. If needed, `memory_list` to discover note names.
3. For dedup / "already seen": `memory_fact_query` before acting.

Never guess from chat history alone when these tools are available.

## Write (when asked to remember)

- Durable prose → `memory_save`
- Structured "seen X" / preferences → `memory_fact_add`
- Close outdated facts → `memory_fact_invalidate` (after `memory_fact_query`)
- Do not use shell `csagent memory …` when MCP tools exist.

## Do not

- Rely on session-start injection (`memory.onStart` is off by default).
- Load all notes into the prompt — pull only what the current task needs.
