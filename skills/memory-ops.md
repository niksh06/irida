---
name: memory-ops
description: Query csagent-memory MCP for agent ops, sessions, and lessons; save durable notes on request. For technology reference use kb-ops instead.
tags: [memory, csagent]
---

Memory is **on-demand**, not preloaded. Do not assume context contains project facts.

**Technology best practices** (Kafka, Python, Docker, security, …) live in the **file KB** — skill **`kb-ops`**, not `memory_search`. Postgres holds csagent state only.

## When retrieval happens

Not every turn runs memory search. **`memory_search` is on-demand** — call it when the task needs stored facts (below). Separate optional layers in `agent.config.json` (see REFERENCE.md «When memory is retrieved»):

| Layer | Trigger | Prod default |
|-------|---------|--------------|
| **preTurn** | Profile/mode prefix every turn (profile on first turn only) | on if configured |
| **onStart** | 1–2 notes on first turn only | **off** |
| **autoRag** | Silent FTS/semantic search every turn | **off** (MCP-first) |
| **MCP `memory_search`** | You call the tool | **on-demand** (this skill) |

CLI `csagent memory search` is manual lookup only — the gateway does not run it automatically.

**Archive wings** (`cursor-ide`, `secure`) are excluded from default search. Use `includeArchive: true` for forensic IDE transcript lookup. Distilled playbooks live in wing **`cursor-lesson`** (default search).

## Read (before answering)

When the user asks about **csagent setup**, TParser, cron, past **agent** decisions, episodic sessions, or cursor-lessons:

For **stack / library / infra** questions → **kb-ops** first; only use memory if the user stored an ops note about it.

When the task is agent memory:

1. Call `memory_search` with relevant keywords, or `memory_get` if you know the note name.
2. If needed, `memory_list` to discover note names.
3. For dedup / "already seen": `memory_fact_query` before acting.

Never guess from chat history alone when these tools are available.

## Write (when asked to remember)

- Durable prose → `memory_save`
- Structured "seen X" / preferences → `memory_fact_add`
- Close outdated facts → `memory_fact_invalidate` with `fact_id` from query, or `subject` + optional `predicate`/`object` scope
- Do not use shell `csagent memory …` when MCP tools exist.

## Do not

- Rely on session-start injection (`memory.onStart` is off by default).
- Load all notes into the prompt — pull only what the current task needs.
