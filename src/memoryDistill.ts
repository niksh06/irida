/**
 * Automatic durable-fact distillation from irida's own sessions (I-113).
 *
 * session-ingest already dumps raw transcripts into the `episodic` wing; this is
 * the *reflect* step the manual `/memory-update` did by hand — a forked agent
 * reads a completed gateway/cron session and writes only DURABLE knowledge
 * (preferences, decisions, corrections, ops lessons) to the `agent-distilled`
 * wing + facts, with dedup. Provenance = the wing tag, so the curator/evolution
 * loop ([I-114]/[I-98]) touch only agent-created memory.
 *
 * Idempotency + cursor live in a state file (no marker notes polluting search).
 * Budget = a per-pass cap on agent runs (attempts, not just successes); respects
 * backgroundPause; skips trivial/test sessions. The distiller runs with
 * persistRun:false so it never distills itself, and barePrompt+attachMcp so it
 * gets the memory tools without the autoRag/session-memory feedback loop.
 *
 * Provenance note: distilled NOTES carry the `agent-distilled` wing; `memory_fact_add`
 * has no wing, so distilled FACTS are not wing-tagged — the prompt therefore steers
 * durable knowledge to notes and reserves facts for preferences/seen-items. Content
 * is the redacted run previews (not full transcripts), so extraction is coarse-grained.
 */
import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadConfig } from "./config.js";
import { createStore, type RunRecord, type SessionRecord } from "./store.js";
import { formatSessionRunsMarkdown } from "./sessionExport.js";
import { shouldSkipEpisodicIngest } from "./sessionIngest.js";
import { isBackgroundPaused } from "./backgroundPause.js";
import { runPrompt } from "./run.js";
import { DISTILL_WING } from "./memoryWings.js";

/** Wing for auto-distilled durable notes (provenance tag = agent-created). Re-exported for callers/tests. */
export { DISTILL_WING };
/** Surfaces worth distilling — the autonomous/interactive ones, not local dev TUI. */
const DISTILL_CHANNELS = new Set(["telegram", "cron"]);
const DEFAULT_MIN_RUNS = 2;
const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_HOURS = 48;
const MAX_CONTENT_CHARS = 12_000;

export interface MemoryDistillState {
  /** sessionId → the session.updated_at we last distilled (re-distill if it changed). */
  processed: Record<string, string>;
}

export interface MemoryDistillResult {
  distilled: number;
  skipped: number;
  paused: boolean;
  names: string[];
}

/** Pure: a non-trivial, non-test, distillable session on a real surface. */
export function isDistillCandidate(
  session: SessionRecord,
  runs: RunRecord[],
  minRuns: number = DEFAULT_MIN_RUNS
): boolean {
  if (!session.channel || !DISTILL_CHANNELS.has(session.channel)) return false;
  if (shouldSkipEpisodicIngest(session, runs)) return false;
  const real = runs.filter((r) => r.is_test !== true && r.status === "finished");
  return real.length >= minRuns;
}

/** Pure: needs distill if never processed or the session changed since. */
export function sessionNeedsDistill(
  session: SessionRecord,
  processedUpdatedAt: string | undefined,
  force: boolean
): boolean {
  if (force || !processedUpdatedAt) return true;
  const s = Date.parse(session.updated_at);
  const p = Date.parse(processedUpdatedAt);
  if (!Number.isFinite(s) || !Number.isFinite(p)) return true;
  return s > p;
}

const EXTRACTION_INSTRUCTION = [
  "You are the irida memory distiller. Below is a completed irida session (the agent's own",
  "gateway/cron work). Extract ONLY durable, reusable knowledge that will matter in future",
  "sessions: confirmed user preferences, decisions, corrections/feedback, and operational",
  "lessons. IGNORE ephemeral chit-chat, one-off task minutiae, and anything obvious from code.",
  "",
  "For each durable item:",
  `- decision / correction / ops lesson (durable knowledge) → memory_save(name, body, wing: "${DISTILL_WING}").`,
  '- a user preference or "seen X" item → memory_fact_add(subject, predicate, object).',
  `Prefer memory_save (the "${DISTILL_WING}" wing tags provenance); use memory_fact_add only for`,
  "genuine preferences / seen-items. First check existing memory (memory_search / memory_fact_query)",
  'and UPDATE rather than duplicate. If nothing is durable, save nothing. Reply with a one-line',
  'summary of what you saved (or "nothing durable").',
].join("\n");

/** Pure: build the distiller prompt for one session (content capped). */
export function buildDistillPrompt(session: SessionRecord, runs: RunRecord[]): string {
  const content = formatSessionRunsMarkdown(session, runs).slice(0, MAX_CONTENT_CHARS);
  const title = session.title?.trim() || session.id;
  return `${EXTRACTION_INSTRUCTION}\n\n=== SESSION ${session.id} (${title}) ===\n\n${content}`;
}

function statePath(dir: string): string {
  return resolve(dir, loadConfig(dir).stateDir, "memory-distill.state.json");
}

export function loadDistillState(dir: string): MemoryDistillState {
  const p = statePath(dir);
  if (!existsSync(p)) return { processed: {} };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return { processed: parsed.processed ?? {} };
  } catch {
    return { processed: {} };
  }
}

export function saveDistillState(dir: string, state: MemoryDistillState): void {
  const p = statePath(dir);
  mkdirSync(resolve(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2));
}

export interface DistillOptions {
  windowHours?: number;
  limit?: number;
  force?: boolean;
}

export async function distillRecentSessions(
  dir: string,
  opts: DistillOptions = {}
): Promise<MemoryDistillResult> {
  if (isBackgroundPaused(dir)) return { distilled: 0, skipped: 0, paused: true, names: [] };

  const cfg = loadConfig(dir);
  const windowMs = Math.max(1, opts.windowHours ?? DEFAULT_WINDOW_HOURS) * 3600_000;
  const cutoff = Date.now() - windowMs;
  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
  const force = opts.force === true;

  const state = loadDistillState(dir);
  const store = createStore(dir, cfg.stateDir);
  const names: string[] = [];
  let distilled = 0;
  let skipped = 0;
  let attempts = 0;

  try {
    const sessions = (await store.listSessions(500)).filter((s) => {
      const t = Date.parse(s.updated_at);
      return Number.isFinite(t) && t >= cutoff;
    });

    for (const session of sessions) {
      if (attempts >= limit) break; // hard cap on agent runs per pass (token-cost bound)
      const runs = await store.listRuns(session.id);
      if (!isDistillCandidate(session, runs)) {
        skipped++;
        continue;
      }
      if (!sessionNeedsDistill(session, state.processed[session.id], force)) {
        skipped++;
        continue;
      }
      attempts++;
      const out = await runPrompt(buildDistillPrompt(session, runs), {
        dir,
        barePrompt: true, // self-contained prompt; no autoRag/session-memory feedback loop
        attachMcp: true, // but DO attach memory MCP so the distiller can write
        persistRun: false, // never distill the distiller's own session
        quiet: true,
      });
      if (out.exitCode === 0) {
        state.processed[session.id] = session.updated_at;
        names.push(session.id);
        distilled++;
      } else {
        skipped++;
      }
    }
  } finally {
    saveDistillState(dir, state); // persist cursor even on a partial/error pass
    await store.close();
  }

  return { distilled, skipped, paused: false, names };
}
