/**
 * Managed evolution loop — safe v1 (I-98). Closes signal → reflect → fitness →
 * gate → report WITHOUT any autonomous apply: the proposer agent only WRITES to
 * an approve-queue (evolution.proposals.json); a human applies. L0 auto-apply
 * already lives in memory-distill (I-113) + memory-consolidate (I-114); L1
 * (agent-created skills) auto-apply is intentionally deferred per the I-98 spec
 * (needs prod-under-git rollback + paired lesson-eval).
 *
 * Invariants honored here: the eval/fitness graph is READ-ONLY to the loop (run
 * as a baseline, never mutated — Goodhart guard); every mutation is a `pending`
 * proposal (nothing applied); respects backgroundPause; one agent run per cycle.
 */
import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadConfig } from "./config.js";
import { isBackgroundPaused } from "./backgroundPause.js";
import { runPrompt } from "./run.js";
import { loadRunLogEntries } from "./runMetrics.js";
import { summarizeLessonEval } from "./cursorLessonEval.js";
import { runEvalBattery, evalRoot } from "./eval_cmd.js";
import type { RunLogEntry } from "./runLog.js";

const DEFAULT_WINDOW_HOURS = 48;
const MAX_PROPOSALS = 50; // ledger cap (FIFO trim of resolved entries)

export interface RunSignals {
  total: number;
  failed: number;
  errorKinds: Record<string, number>;
}

export interface EvolutionProposal {
  id: string;
  at: string;
  kind: "memory" | "skill" | "other";
  title: string;
  detail: string;
  status: "pending" | "applied" | "rejected";
}

export interface EvolutionLedger {
  proposals: EvolutionProposal[];
}

/** Pure: aggregate recent run outcomes into an error signal. */
export function summarizeRunSignals(entries: RunLogEntry[], now: number, windowHours: number = DEFAULT_WINDOW_HOURS): RunSignals {
  const cutoff = now - windowHours * 3600_000;
  const recent = entries.filter((e) => {
    const t = Date.parse(e.ts);
    return Number.isFinite(t) && t >= cutoff;
  });
  const errorKinds: Record<string, number> = {};
  let failed = 0;
  for (const e of recent) {
    if (e.status !== "finished" && e.status !== "injected") {
      failed++;
      const k = e.error_kind || e.status || "unknown";
      errorKinds[k] = (errorKinds[k] ?? 0) + 1;
    }
  }
  return { total: recent.length, failed, errorKinds };
}

/** Pure: is there anything worth proposing about (failures, lesson gaps, or red evals)? */
export function hasSignalToPropose(signals: RunSignals, lessonGaps: number, evalFailures: number): boolean {
  return signals.failed > 0 || lessonGaps > 0 || evalFailures > 0;
}

const PROPOSER_INSTRUCTION = [
  "You are the irida evolution proposer. Based on the signals below, propose AT MOST ONE concrete,",
  "small improvement to the agent's durable memory or skills that would reduce the observed failures",
  "or close a lesson gap. You are NOT applying anything — your proposal goes to a human approve-queue.",
  "",
  "Use memory_search / memory_fact_query (read-only) to check what already exists; do NOT write memory.",
  "Reply in this exact shape:",
  "KIND: memory | skill | other",
  "TITLE: <one line>",
  "DETAIL: <2-5 lines: what to change, why it helps, how to verify>",
  'If nothing is worth changing, reply exactly "NO PROPOSAL".',
].join("\n");

/** Pure: build the proposer prompt from the gathered signals. */
export function buildProposerPrompt(signalsText: string): string {
  return `${PROPOSER_INSTRUCTION}\n\n=== signals ===\n\n${signalsText}`;
}

/** Pure: parse the proposer reply into a structured proposal, or null for no-op. */
export function parseProposal(text: string, id: string, at: string): EvolutionProposal | null {
  const t = text.trim();
  if (!t || /^NO PROPOSAL/i.test(t)) return null;
  const kindM = t.match(/KIND:\s*(memory|skill|other)/i);
  const titleM = t.match(/TITLE:\s*(.+)/i);
  const detailM = t.match(/DETAIL:\s*([\s\S]+)/i);
  if (!titleM) return null; // not in expected shape → treat as no usable proposal
  const kind = (kindM?.[1]?.toLowerCase() as EvolutionProposal["kind"]) || "other";
  return {
    id,
    at,
    kind,
    title: titleM[1].trim().slice(0, 200),
    detail: (detailM?.[1] ?? t).trim().slice(0, 1000),
    status: "pending",
  };
}

function ledgerPath(dir: string): string {
  return resolve(dir, loadConfig(dir).stateDir, "evolution.proposals.json");
}

export function loadProposals(dir: string): EvolutionLedger {
  const p = ledgerPath(dir);
  if (!existsSync(p)) return { proposals: [] };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return { proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [] };
  } catch {
    return { proposals: [] };
  }
}

export function saveProposals(dir: string, ledger: EvolutionLedger): void {
  const p = ledgerPath(dir);
  mkdirSync(resolve(p, ".."), { recursive: true });
  // Never drop pending (human-owned). Cap only the resolved tail.
  const pending = ledger.proposals.filter((x) => x.status === "pending");
  const resolved = ledger.proposals.filter((x) => x.status !== "pending");
  const trimmed = [...pending, ...resolved.slice(0, Math.max(0, MAX_PROPOSALS - pending.length))];
  writeFileSync(p, JSON.stringify({ proposals: trimmed }, null, 2));
}

export interface EvolutionResult {
  paused: boolean;
  proposed: boolean;
  evalOk: boolean;
  signals: RunSignals;
  summary: string;
}

export async function runEvolutionCycle(dir: string, opts: { windowHours?: number } = {}): Promise<EvolutionResult> {
  const empty: RunSignals = { total: 0, failed: 0, errorKinds: {} };
  if (isBackgroundPaused(dir)) {
    return { paused: true, proposed: false, evalOk: true, signals: empty, summary: "skipped (background paused)" };
  }

  const cfg = loadConfig(dir);
  const now = Date.now();

  // Fitness baseline — READ-ONLY. The loop never edits the eval graph.
  let evalOk = true;
  let evalFailures = 0;
  try {
    const battery = runEvalBattery(evalRoot());
    evalOk = battery.ok;
    evalFailures = battery.results.filter((r) => !r.ok).length;
  } catch {
    /* eval set absent → treat as no fitness signal */
  }

  const signals = summarizeRunSignals(loadRunLogEntries(dir, cfg.stateDir), now, opts.windowHours);

  let lessonGaps = 0;
  let lessonText = "lesson-eval: n/a";
  try {
    const ls = await summarizeLessonEval(dir);
    lessonGaps = ls.rows.filter((r) => r.verdict && r.verdict !== "pass").length;
    lessonText = `lesson-eval: ${ls.rows.length} row(s), ${lessonGaps} not-pass, ${ls.archiveCandidates.length} archive-candidate(s)`;
  } catch {
    /* lesson eval optional */
  }

  if (!hasSignalToPropose(signals, lessonGaps, evalFailures)) {
    return { paused: false, proposed: false, evalOk, signals, summary: `no signal to evolve (evals ${evalOk ? "green" : "RED"})` };
  }

  // Safety gate: the read-only proposer relies on `disallowedTools`, which only the
  // claude-agent engine enforces. The cursor SDK silently ignores it (no tool hooks),
  // so on cursor the proposer would run with full write/bash tools — refuse rather
  // than propose with an unenforced read-only guarantee.
  if (cfg.engine.provider !== "claude-agent") {
    return {
      paused: false,
      proposed: false,
      evalOk,
      signals,
      summary: `signal present but proposer skipped: read-only enforcement needs the claude-agent engine (current: ${cfg.engine.provider})`,
    };
  }

  const errLines = Object.entries(signals.errorKinds).map(([k, n]) => `  - ${k}: ${n}`).join("\n") || "  (none)";
  const signalsText = [
    `runs (${opts.windowHours ?? DEFAULT_WINDOW_HOURS}h): ${signals.total} total, ${signals.failed} failed`,
    `error kinds:\n${errLines}`,
    `evals: ${evalOk ? "green" : `RED (${evalFailures} failing)`}`,
    lessonText,
  ].join("\n");

  const out = await runPrompt(buildProposerPrompt(signalsText), {
    dir,
    barePrompt: true,
    attachMcp: true, // read-only memory access to check existing knowledge
    // Invariant: the proposer PROPOSES, never applies. Block every file/exec
    // mutation tool so it cannot touch skills, the eval graph, or code — its
    // only output is the text proposal that lands in the approve-queue.
    disallowedTools: [
      "Write",
      "Edit",
      "MultiEdit",
      "NotebookEdit",
      "Bash",
      // all three csagent-memory writers (read tools stay available for "check existing")
      "mcp__csagent-memory__memory_save",
      "mcp__csagent-memory__memory_fact_add",
      "mcp__csagent-memory__memory_fact_invalidate",
    ],
    persistRun: false,
    quiet: true,
  });

  const proposal = parseProposal(out.text ?? "", `ev_${now.toString(36)}`, new Date(now).toISOString());
  if (!proposal) {
    return { paused: false, proposed: false, evalOk, signals, summary: `signal present but proposer returned no proposal` };
  }

  const ledger = loadProposals(dir);
  ledger.proposals.unshift(proposal);
  saveProposals(dir, ledger);

  return {
    paused: false,
    proposed: true,
    evalOk,
    signals,
    summary: `proposed [${proposal.kind}] ${proposal.title} → evolution.proposals.json (pending approve)`,
  };
}
