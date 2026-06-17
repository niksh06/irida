# topicDelegates → contextFrom migration (I-43)

**Date:** 2026-06-17  
**Status:** decision recorded · **Issue:** I-43  
**Scope:** `tparser-daily-digest` (5 topic delegates + synthesizer)

## Current state

| Piece | Implementation |
|-------|------------------|
| Daily digest | `topicDelegates: true` in prod `tparser-daily-digest` |
| Topic runs | 5 isolated SDK subagents (`tparser-daily-topic.prompt.txt`) |
| Synthesize | 1 SDK run merges sections (`tparser-daily-synthesize.prompt.txt`) |
| Window vars | `{WINDOW_HOURS}`, `{WINDOW_START}`, `{WINDOW_END}`, `{TOPIC_*}` injected in code (`cronTopicDigest.ts`) |
| Quality | Battle-tested; digest QA (`digest-qa.sh`) wired |

Generic **`contextFrom`** pipeline (I-41/I-42) now supports script → SDK chains (see `reddit-rss-fetch` → `reddit-digest-daily`).

## Options considered

### A — Full migrate to contextFrom-only jobs

Example shape (not prod):

```
tparser-topic-ai      (SDK, topic prompt, artifact)
tparser-topic-aisec   …
…
tparser-daily-synth     (contextFrom: concat upstream, synthesize prompt)
```

**Pros:** uniform cron model; easier to add/remove topics in JSON.  
**Cons:** loses built-in `{TOPIC_ID}` / tag hints / parallel topic fan-out; higher regression risk; more prompt files to keep in sync; no token savings without re-design.

### B — Keep topicDelegates (recommended)

**Pros:** optimized path in `cronTopicDigest.ts`; stable prod output; QA hooks unchanged.  
**Cons:** special-case flag remains in codebase.

### C — Hybrid parallel run

Run contextFrom chain in shadow mode, compare to topicDelegates output before cutover.

**Pros:** evidence-based migration.  
**Cons:** 2× SDK cost nightly until decision; needs HITL diff review.

## Decision

**Keep `topicDelegates` for `tparser-daily-digest` (option B).**

Rationale:

1. Reddit digest (I-77) proves `contextFrom` for **linear** ETL (fetch → summarize); TParser daily is **fan-out + merge** with dynamic topic metadata — poor fit for config-only expression today.
2. No user-visible benefit until topic list changes often (it does not).
3. Regression cost outweighs architectural purity pre-triggers epic.

## If revisiting later

Prerequisites before migration:

- [ ] Generic `{TOPIC_*}` placeholder injection for contextFrom jobs (or N explicit job ids in example)
- [ ] Shadow-run QA comparing digest bodies ≥7 nights
- [ ] User sign-off on PERSONAL-OPS cutover checklist

Deprecating `topicDelegates` should remain a **separate AFK issue** after the above.

## Related

- I-42 cron tick ordering — done
- I-77 reddit pipeline — reference implementation for linear contextFrom
- `deploy/cron.jobs.example.json` — reddit jobs; tparser daily unchanged
