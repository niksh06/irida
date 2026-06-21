/**
 * Memory consolidation — the "dream" pass (I-114). Periodically (cadence OR
 * growth threshold) a forked agent reviews the auto-distilled notes (`agent-distilled`
 * wing, written by I-113), merges near-duplicates into one note, and archives the
 * superseded originals into `agent-distilled-archive` (excluded from default search,
 * not deleted — there is no delete MCP tool, and archive-not-delete is reversible).
 *
 * Scope: only the agent-created wing (user/bundled memory untouched). Budget = one
 * agent run per pass; respects backgroundPause; an advisory lock prevents a second
 * consolidation (and overlap with a long memory-distill) from running concurrently.
 */
import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, rmSync } from "node:fs";
import { loadConfig } from "./config.js";
import { createMemoryStore } from "./memoryStore.js";
import { isBackgroundPaused } from "./backgroundPause.js";
import { runPrompt } from "./run.js";
import { DISTILL_WING, DISTILL_ARCHIVE_WING } from "./memoryWings.js";

const DEFAULT_MIN_NOTES = 5;
const DEFAULT_GROWTH_THRESHOLD = 10;
const DEFAULT_CADENCE_HOURS = 168; // weekly
const MAX_CONTENT_CHARS = 16_000;
const LOCK_STALE_MS = 30 * 60_000;

export interface ConsolidateState {
  lastRunAt?: string;
  lastNoteCount?: number;
}

export interface ConsolidateDecision {
  run: boolean;
  reason: string;
}

export interface ConsolidateOptions {
  minNotes?: number;
  growthThreshold?: number;
  cadenceHours?: number;
  force?: boolean;
}

/** Pure: should this pass run, given the current note count + last-run state? */
export function shouldConsolidate(
  noteCount: number,
  state: ConsolidateState,
  now: number,
  opts: ConsolidateOptions = {}
): ConsolidateDecision {
  const minNotes = opts.minNotes ?? DEFAULT_MIN_NOTES;
  if (noteCount < minNotes) return { run: false, reason: `only ${noteCount} distilled notes (< ${minNotes})` };
  if (opts.force) return { run: true, reason: "forced" };
  const growth = noteCount - (state.lastNoteCount ?? 0);
  if (growth >= (opts.growthThreshold ?? DEFAULT_GROWTH_THRESHOLD)) {
    return { run: true, reason: `${growth} new distilled notes since last pass` };
  }
  const lastMs = state.lastRunAt ? Date.parse(state.lastRunAt) : 0;
  const cadenceMs = (opts.cadenceHours ?? DEFAULT_CADENCE_HOURS) * 3600_000;
  if (now - lastMs >= cadenceMs) return { run: true, reason: "cadence due" };
  return { run: false, reason: "no significant growth and cadence not due" };
}

const CONSOLIDATE_INSTRUCTION = [
  "You are the irida memory consolidator. Below are the auto-distilled durable memory notes",
  `(wing "${DISTILL_WING}"). Reduce redundancy WITHOUT losing knowledge.`,
  "",
  "- Find clusters of near-duplicate or strongly overlapping notes. For each cluster, write ONE",
  `  consolidated note via memory_save(name, body, wing: "${DISTILL_WING}") — reuse the clearest`,
  "  existing name. Then archive each superseded original by calling",
  `  memory_save(name: <original-name>, body: <its original body>, wing: "${DISTILL_ARCHIVE_WING}")`,
  "  so it leaves active recall (this is archive, not delete — reversible).",
  "- Leave genuinely distinct notes untouched. Do NOT touch any other wing. Do NOT invent content.",
  "",
  'Reply with a one-line summary: "consolidated N cluster(s), archived M note(s), kept K".',
].join("\n");

/** Pure: build the consolidation prompt from the distilled notes (content capped). */
export function buildConsolidatePrompt(notes: Array<{ name: string; body: string }>): string {
  const lines: string[] = [];
  let total = 0;
  for (const n of notes) {
    const block = `## ${n.name}\n\n${n.body.trim()}\n`;
    if (total + block.length > MAX_CONTENT_CHARS) break;
    lines.push(block);
    total += block.length;
  }
  return `${CONSOLIDATE_INSTRUCTION}\n\n=== ${DISTILL_WING} notes ===\n\n${lines.join("\n")}`;
}

function statePath(dir: string): string {
  return resolve(dir, loadConfig(dir).stateDir, "memory-consolidate.state.json");
}
function lockPath(dir: string): string {
  return resolve(dir, loadConfig(dir).stateDir, "memory-consolidate.lock");
}

export function loadConsolidateState(dir: string): ConsolidateState {
  const p = statePath(dir);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ConsolidateState;
  } catch {
    return {};
  }
}
export function saveConsolidateState(dir: string, state: ConsolidateState): void {
  const p = statePath(dir);
  mkdirSync(resolve(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2));
}

/** Advisory lock: true if acquired; false if a fresh lock is already held. Stale locks are reclaimed. */
function acquireLock(dir: string, now: number): boolean {
  const p = lockPath(dir);
  if (existsSync(p)) {
    try {
      if (now - statSync(p).mtimeMs < LOCK_STALE_MS) return false;
    } catch {
      /* unreadable → treat as stale */
    }
  }
  mkdirSync(resolve(p, ".."), { recursive: true });
  writeFileSync(p, new Date(now).toISOString());
  return true;
}
function releaseLock(dir: string): void {
  try {
    rmSync(lockPath(dir));
  } catch {
    /* already gone */
  }
}

export interface ConsolidateResult {
  ran: boolean;
  reason: string;
  noteCount: number;
  paused: boolean;
  summary?: string;
}

export async function consolidateMemory(
  dir: string,
  opts: ConsolidateOptions = {}
): Promise<ConsolidateResult> {
  if (isBackgroundPaused(dir)) return { ran: false, reason: "background paused", noteCount: 0, paused: true };

  const now = Date.now();
  if (!acquireLock(dir, now)) {
    return { ran: false, reason: "another consolidation is running", noteCount: 0, paused: false };
  }

  const cfg = loadConfig(dir);
  const store = createMemoryStore(dir, cfg.stateDir);
  try {
    const notes = await store.listNotes(DISTILL_WING);
    const state = loadConsolidateState(dir);
    const decision = shouldConsolidate(notes.length, state, now, opts);
    if (!decision.run) {
      saveConsolidateState(dir, { ...state, lastNoteCount: notes.length });
      return { ran: false, reason: decision.reason, noteCount: notes.length, paused: false };
    }

    const out = await runPrompt(buildConsolidatePrompt(notes.map((n) => ({ name: n.name, body: n.body }))), {
      dir,
      barePrompt: true,
      attachMcp: true,
      persistRun: false,
      quiet: true,
    });
    const afterCount = (await store.listNotes(DISTILL_WING)).length;
    const delta = notes.length - afterCount; // notes that left the active wing (archived/merged)
    saveConsolidateState(dir, { lastRunAt: new Date(now).toISOString(), lastNoteCount: afterCount });
    return {
      ran: out.exitCode === 0,
      reason: decision.reason,
      noteCount: notes.length,
      paused: false,
      summary: `${decision.reason}; ${notes.length}→${afterCount} active (-${delta})${out.text?.trim() ? `; ${out.text.trim().slice(0, 200)}` : ""}`,
    };
  } finally {
    await store.close();
    releaseLock(dir);
  }
}
