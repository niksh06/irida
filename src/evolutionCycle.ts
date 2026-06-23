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
import { evaluateSkillFitness, loadSkillEvalTasks } from "./skillFitness.js";
import type { SkillRunner, SkillJudge, SkillEvalTask } from "./skillFitness.js";
import { makeSkillRunner, makeSkillJudge } from "./skillFitnessRunner.js";
import { applyAgentSkill } from "./skillApply.js";
import { skillFromMarkdown } from "./skills.js";
import type { RunLogEntry } from "./runLog.js";
import type { AgentConfig } from "./config.js";

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
  /** Skill slug (kind=skill only). */
  name?: string;
  /** Full skill markdown drafted by the proposer (kind=skill, when auto-apply is in play). */
  body?: string;
  /** Fitness verdict summary recorded when the auto-apply gate ran. */
  fitness?: string;
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
  "NAME: <kebab-case slug, skill only>",
  "TITLE: <one line>",
  "DETAIL: <2-5 lines: what to change, why it helps, how to verify>",
  "BODY: <skill only — a COMPLETE skill markdown: frontmatter (name, description, tags)",
  "then the guidance body. Keep it focused and safe; it may be auto-applied after a fitness eval.>",
  'If nothing is worth changing, reply exactly "NO PROPOSAL".',
].join("\n");

/** Pure: build the proposer prompt from the gathered signals + the pending queue (so it won't re-propose). */
export function buildProposerPrompt(signalsText: string, pendingTitles: string[] = []): string {
  const dedup = pendingTitles.length
    ? `\n\n=== already proposed (pending human review) ===\nDo NOT re-propose any of these or a close variant. If your idea overlaps any of them, reply exactly "NO PROPOSAL":\n${pendingTitles.map((t) => `- ${t}`).join("\n")}`
    : "";
  return `${PROPOSER_INSTRUCTION}\n\n=== signals ===\n\n${signalsText}${dedup}`;
}

const TITLE_STOPWORDS = new Set([
  "a", "an", "the", "to", "for", "of", "into", "on", "in", "and", "or", "its", "is", "with",
  "that", "when", "add", "note", "runs", "run", "irida", "gateway",
]);

/** Significant lowercased tokens of a proposal title (stopwords + short words dropped). */
function titleTokens(title: string): string[] {
  return [
    ...new Set(
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter((w) => w.length > 2 && !TITLE_STOPWORDS.has(w))
    ),
  ];
}

/**
 * Pure: is `candidate` a near-duplicate of any PENDING proposal? Deliberately a
 * HIGH-PRECISION backstop — a false positive would silently drop a distinct, real
 * improvement (the worst outcome), so it fires only on strong lexical overlap:
 * ≥2 shared significant title words AND either Jaccard ≥0.6 (near-identical) or
 * coverage ≥0.8 (one title's concepts almost fully inside the other). Looser
 * semantic near-dupes are left to the proposer prompt (which lists the pending
 * queue and is told to reply "NO PROPOSAL" on overlap) and to the human reviewer.
 */
export function isDuplicateProposal(candidate: EvolutionProposal, existing: EvolutionProposal[]): boolean {
  const a = titleTokens(candidate.title);
  if (a.length < 2) return false; // too little signal to judge similarity
  const aset = new Set(a);
  for (const e of existing) {
    if (e.status !== "pending") continue;
    const b = titleTokens(e.title);
    if (b.length === 0) continue;
    const inter = b.filter((t) => aset.has(t)).length;
    if (inter < 2) continue;
    const union = new Set([...a, ...b]).size;
    const jaccard = inter / union;
    const coverage = inter / Math.min(a.length, b.length);
    if (jaccard >= 0.6 || coverage >= 0.8) return true;
  }
  return false;
}

/** Pure: parse the proposer reply into a structured proposal, or null for no-op. */
export function parseProposal(text: string, id: string, at: string): EvolutionProposal | null {
  const t = text.trim();
  if (!t || /^NO PROPOSAL/i.test(t)) return null;
  const kindM = t.match(/KIND:\s*(memory|skill|other)/i);
  const nameM = t.match(/NAME:\s*(.+)/i);
  const titleM = t.match(/TITLE:\s*(.+)/i);
  // DETAIL stops at BODY (lazy) so a drafted skill body doesn't leak into the detail.
  const detailM = t.match(/DETAIL:\s*([\s\S]+?)(?:\n\s*BODY:|$)/i);
  // Line-anchored (mirrors DETAIL) so an inline "BODY:" inside DETAIL can't mis-capture.
  const bodyM = t.match(/(?:^|\n)\s*BODY:\s*([\s\S]+)$/i);
  if (!titleM) return null; // not in expected shape → treat as no usable proposal
  const kind = (kindM?.[1]?.toLowerCase() as EvolutionProposal["kind"]) || "other";
  const name = nameM?.[1]?.trim().slice(0, 80);
  const body = bodyM?.[1]?.trim();
  const proposal: EvolutionProposal = {
    id,
    at,
    kind,
    title: titleM[1].trim().slice(0, 200),
    detail: (detailM?.[1] ?? t).trim().slice(0, 1000),
    status: "pending",
  };
  if (kind === "skill" && name) proposal.name = name;
  if (kind === "skill" && body) proposal.body = body;
  return proposal;
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

export interface AutoApplyOutcome {
  applied: boolean;
  /** Human-readable fitness verdict, recorded on the proposal either way. */
  fitness: string;
  summary: string;
}

/**
 * L1 auto-apply attempt for a drafted skill (I-98). Runs the fitness gate; on a
 * clear pass, applies the skill (which re-scans it for safety). Anything short of
 * a pass returns applied:false so the caller routes it to the human approve-queue.
 * Engine MUST already be gated to claude-agent (read-only eval enforcement).
 */
export async function tryAutoApplySkill(
  dir: string,
  cfg: AgentConfig,
  proposal: EvolutionProposal,
  deps: { runner?: SkillRunner; judge?: SkillJudge; tasks?: SkillEvalTask[] } = {}
): Promise<AutoApplyOutcome> {
  if (!proposal.name || !proposal.body) {
    return { applied: false, fitness: "no drafted skill body", summary: `skill "${proposal.title}" lacks a body → queued` };
  }
  let tasks = deps.tasks;
  if (!tasks) {
    try {
      tasks = loadSkillEvalTasks().tasks;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { applied: false, fitness: `fitness skipped: ${msg}`, summary: `skill "${proposal.title}" not gated (no eval graph) → queued` };
    }
  }

  const skill = skillFromMarkdown(proposal.body, proposal.name);
  const ctx = { dir, engine: "claude-agent", auth: cfg.engine.auth, model: cfg.engine.model };
  const runner = deps.runner ?? makeSkillRunner(ctx);
  const judge = deps.judge ?? makeSkillJudge(ctx);
  const verdict = await evaluateSkillFitness(skill, tasks, runner, judge);
  const fitness = `fitness ${verdict.pass ? "PASS" : "FAIL"} (score ${verdict.score.toFixed(2)}): ${verdict.reason}`;

  if (!verdict.pass) {
    return { applied: false, fitness, summary: `skill "${proposal.title}" below gate → queued for review (${verdict.reason})` };
  }
  const res = applyAgentSkill(dir, cfg.skillsPath, proposal.name, proposal.body, { evalScore: verdict.score });
  if (!res.applied) {
    return { applied: false, fitness: `${fitness}; apply refused: ${res.reason}`, summary: `skill "${proposal.title}" cleared gate but apply refused (${res.reason}) → queued` };
  }
  return { applied: true, fitness, summary: `auto-applied skill "${proposal.name}" — ${verdict.reason}; ${res.reason}` };
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

  // Load the queue up front so the proposer sees what's already pending (dedup).
  const ledger = loadProposals(dir);
  const pendingTitles = ledger.proposals.filter((p) => p.status === "pending").map((p) => p.title);

  const out = await runPrompt(buildProposerPrompt(signalsText, pendingTitles), {
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

  // Backstop dedup: drop near-duplicates of a pending proposal even if the proposer ignored the queue.
  if (isDuplicateProposal(proposal, ledger.proposals)) {
    return {
      paused: false,
      proposed: false,
      evalOk,
      signals,
      summary: `skipped duplicate proposal "${proposal.title}" (already pending)`,
    };
  }

  // L1 auto-apply (opt-in, claude-agent only — already gated above). A drafted
  // skill that clears the fitness gate is applied directly; anything short of a
  // pass is annotated and falls through to the human approve-queue.
  if (proposal.kind === "skill" && proposal.body && proposal.name && cfg.engine.evolution?.autoApplySkills) {
    const outcome = await tryAutoApplySkill(dir, cfg, proposal);
    proposal.fitness = outcome.fitness;
    if (outcome.applied) {
      proposal.status = "applied";
      ledger.proposals.unshift(proposal);
      saveProposals(dir, ledger);
      return { paused: false, proposed: true, evalOk, signals, summary: outcome.summary };
    }
    proposal.detail = `${proposal.detail}\n\n[auto-apply gate] ${outcome.fitness}`.slice(0, 1000);
  }

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
