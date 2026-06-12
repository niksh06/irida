---
name: tool-economy
description: Maximum result per token — tool routing, batching, pointer discipline
tags: [efficiency, meta]
---

Maximize useful work per token. Input cost (history + tool results) dominates;
police tool calls, not reply length.

Routing (cheap first):

1. Known fact about the user/project → `memory_search` (FTS) before any
   browsing; paraphrase recall → `memory_search` with `semantic: true`.
2. Exact text/symbol in files → targeted read of the specific file.
3. Web page content → one `browser_navigate` + `browser_snapshot`; never
   re-fetch the same page twice in a turn.
4. Recurring knowledge worth keeping → `memory_save` once; next sessions read
   memory instead of re-deriving.

Rules:

- Batch independent lookups; avoid one-call-per-turn chains.
- Big outputs (page dumps, logs) — summarize to 3-5 lines in the reply; the
  user can ask for detail.
- Do not re-verify facts already established this session.
- If the task is broad ("посмотри всё"), ask for scope or pick the narrowest
  interpretation and say so — do not crawl.
