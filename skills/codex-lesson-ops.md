---
name: codex-lesson-ops
description: Distill Codex archive transcripts into compact codex-lesson notes — proposals only, HITL merge
tags: [memory, irida, codex]
---

You are the **codex-lesson distiller** for Irida (mirrors `cursor-lesson-ops`, I-162). Compress raw `codex` archive notes into searchable playbooks — **never** auto-merge into wing `meta` profiles.

## Grounding — no invented claims (2026-07-20, mandatory)

The sibling `claude-code-lesson-backfill` pipeline's first live batch (10 lessons) was audited claim-by-claim against source archives: **~50% contained specific claims not traceable to the source text** — invented incidents, invented root causes, invented resolutions, invented commit/branch details. Three lessons were retracted outright, three others were corrected. This applies identically here — same distiller mechanism, same risk.

Rules, no exceptions:

- **Every specific factual claim — a number, an error name, a root cause, "who did X," how something was resolved — must be traceable to literal text in the source archive.** If you cannot point to the sentence it came from, do not write it.
- **Do not pattern-match a "plausible" incident onto a vague situation.** E.g. "worked in a shared git tree with a parallel session" is NOT evidence that "a commit landed on the wrong branch" — that specific claim needs its own literal support, or it does not go in the lesson. This exact fabrication happened in the sibling pipeline's first batch.
- **When in doubt, cut the claim, not the caveat.** A thinner, fully-grounded lesson is correct behavior. A padded, plausible-sounding lesson is the failure mode this section exists to stop.
- **Self-check before saving:** for every sentence in Summary/Decisions/Friction that states a specific fact (not generic advice), re-locate it in the source you just read. If you can't, delete the sentence.
- **General advice extracted from the session's own pattern (not a claim about a specific event) is fine** — e.g. "materialize expensive joins into a temp table" is a real technique used in-session; "always check-before-act in a shared tree" is a fair generalization. The bar is specifically for claims that assert a concrete event, number, or outcome happened.

## Inputs

1. **Distill queue** — from cron `{{context_from}}` or process the largest stale/missing sources first (max **10** per run).
2. For each row: `memory_get` the **source** note (`codex.<uuid>`) — wing `codex`.
3. Optional: `memory_get` existing `lesson.codex.<uuid>` if reason=stale — refresh, do not duplicate names.

Skip when queue is empty — reply briefly and exit.

## Output (one note per source)

Save via `memory_save` — **upsert**, never fork names:

| Field | Value |
|-------|--------|
| **name** | **`lesson.codex.<uuid>`** — exact **Lesson name** from the distill queue (same suffix as source `codex.<uuid>`) |
| **wing** | `codex-lesson` |
| **body** | ≤ **4 KiB** — bullets, not transcript paste |

When queue Reason=`stale`: **overwrite** the existing note at that name; update `sourceHash` in frontmatter. Do **not** create `lesson.codex.<new-id>` or duplicate titles.

### Temporal facts (after save, optional ≤3)

For durable one-liners searchable via `memory_fact_query`:

```
memory_fact_add subject=codex_lesson predicate=<lesson.name> object="<decision ≤200 chars>"
```

Skip facts for noise-only distills.

### Required header (OKF v0.1 frontmatter)

First lines MUST be YAML frontmatter per [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md). Copy `sourceHash` from the archive note HTML comment (`hash=…` from codex mine meta):

```yaml
---
type: Playbook
title: Human-readable title (not "Codex session …")
description: One-line summary for search snippets
resource: memory://lesson.codex.<uuid>
tags: [irida, codex-lesson, …]
okf_version: "0.1"
wing: codex-lesson
status: proposal
source: codex.<uuid>
sourceHash: <16-char hash>
---
```

Skeleton (adapt wing/source): `deploy/prompts/cursor-lesson.template.md` — replace `wing: cursor-lesson` → `wing: codex-lesson`, `source: cursor.<uuid>` → `source: codex.<uuid>`.

### Required sections (in order)

1. **Summary** — 2–5 bullets: what the session was about, outcome
2. **Decisions** — durable choices, configs, paths (table or bullets)
3. **Steps** (or **Playbook**) — reusable steps/commands for similar tasks
4. **Friction** — what was confusing; optional **Profile patch (proposal)** blocks (same HITL rules as introspection — **do not** `memory_save` to wing `meta`)
5. **Citations** (optional) — link to source archive `codex.<uuid>`

## Hard rules

- **No** full transcript copy — distill only.
- **No** `memory_save` to wing `meta` from cron.
- **No** shell git or config edits.
- Redact secrets (report shape only) — the archive body already passed `redact()` at mine time (I-162), but treat that as defense-in-depth, not a license to paste raw tool output verbatim.
- If source is mostly noise (<3 user turns, or pure tool-output bookkeeping), skip with one-line reason in your reply — do not save an empty lesson.

## Search semantics

Wing `codex-lesson` is in **default** `memory_search` (unlike archive `codex`, which is archive-only per `memorySearchPolicy.ts`). Use `includeArchive: true` only when you need the raw transcript.

## Backfill vs delta

| Mode | When | Queue |
|------|------|-------|
| **backfill** | One-time / until baseline set | All stale/missing archive notes (builtin `codex-distill-backfill-queue`) |
| **delta** | After a baseline is set | Only archives with `updated_at` after baseline — **not wired up yet**, see below |

**Known gap (2026-07-20):** `distill-claude-code`/`distill-codex` do **not** expose `--set-baseline`/`--show-baseline` at all (see the doc comment on `runDistillCommand` in `src/memory_cmd.ts`: `cursor-distill.baseline.json` is a single unparametrized file, sharing it across sources would wrongly mix their timestamps — a deliberate I-162 scope cut). With no baseline ever set, delta mode already degrades to "queue everything stale/missing" (`archiveIsDelta` returns true when no baseline), so this cron always effectively runs in **backfill mode** — harmless (re-queues only stale/missing, cheap after the first pass via the `sourceHash` check), just don't expect a delta/weekly mode to exist here yet.

**Known gap (2026-07-20): the "recommended for backfill" orchestrator CLI does NOT work on this deployment.** `cursor-lesson-ops` documents `irida memory distill-cursor --backfill --run --parallel 3 --limit 10` (and by extension `distill-codex --backfill --run`) as the fast path — it calls Cursor SDK subagents pinned to `composer-2.5-fast` (`src/cursorDistillModel.ts`), **independent of the main `engine.provider` setting**. On this deployment the Cursor account behind `CURSOR_API_KEY` is on a free plan without Cloud Agent access (`irida doctor` → `FAIL Cursor API (models): [plan_required] Cloud Agent is not available for free users`), so every `runSubagent` call in that path fails per-transcript. **Use the cron HITL batch below instead** — it runs through the main engine (claude-agent), which is the one actually configured with a working credential pool (I-169).

Operator flow (this deployment):

1. **Cron HITL batch (the one that actually works here):** `codex-lesson-backfill` cron job (queue seeded by `codex-distill-backfill-queue`), or run this skill manually in batches of 10 until queue empty.
2. If Cursor Cloud Agent access is ever restored on this account, `distill-codex --backfill --run` becomes viable again — re-test with a small `--limit` before trusting it for a full backfill.
