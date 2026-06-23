/**
 * Turnkey skill fitness gate (I-98 L1, phase 2). Closes the HITL gap that
 * blocked autonomous apply: instead of a human running each task twice and
 * recording a verdict, this runs the agent on a curated task set WITH and
 * WITHOUT the candidate skill and an LLM judge scores the lift.
 *
 * The runner + judge are INJECTED so the aggregation logic is unit-testable with
 * canned responses (no live SDK in CI — same constraint the rest of eval honors);
 * the real SDK-backed runner/judge are wired in on prod (claude-agent engine).
 *
 * Goodhart guard: the task set is human-curated and repo-owned
 * (`eval/cases/skill-fitness/tasks.json`). The evolution loop cannot add eval
 * tasks (its disallowedTools block Write/Edit) — it can only be measured by them.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Skill } from "./skills.js";

export interface SkillEvalTask {
  id: string;
  /** What the agent is asked to do — the situation the skill should help with. */
  prompt: string;
  /** What "good" looks like — the judge scores baseline vs with-skill against this. */
  rubric: string;
}

export interface SkillEvalTasksFile {
  version: number;
  tasks: SkillEvalTask[];
}

export function defaultSkillEvalTasksPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../eval/cases/skill-fitness/tasks.json");
}

export function loadSkillEvalTasks(tasksPath?: string): SkillEvalTasksFile {
  const path = tasksPath ?? defaultSkillEvalTasksPath();
  if (!existsSync(path)) throw new Error(`skill eval tasks missing: ${path}`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<SkillEvalTasksFile>;
  if (!Array.isArray(raw.tasks)) throw new Error(`${path}: tasks must be an array`);
  const tasks: SkillEvalTask[] = [];
  for (const row of raw.tasks) {
    if (row == null || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as unknown as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
    const rubric = typeof o.rubric === "string" ? o.rubric.trim() : "";
    if (!id || !prompt || !rubric) continue;
    tasks.push({ id, prompt, rubric });
  }
  if (!tasks.length) throw new Error(`${path}: no valid tasks`);
  return { version: typeof raw.version === "number" ? raw.version : 1, tasks };
}

/** Run the agent on a task; `skill` null = baseline (no skill injected). Returns the response text. */
export type SkillRunner = (prompt: string, skill: Skill | null) => Promise<string>;

export type PairedVerdict = "better" | "worse" | "same";

/** Judge whether the with-skill response is better/worse/same than baseline on the rubric. */
export type SkillJudge = (
  task: SkillEvalTask,
  baseline: string,
  withSkill: string
) => Promise<{ verdict: PairedVerdict; note: string }>;

export interface SkillFitnessTaskResult {
  id: string;
  verdict: PairedVerdict | "error";
  note: string;
}

export interface SkillFitnessVerdict {
  pass: boolean;
  /** Net lift in [-1, 1]: (better − worse) / tasks. */
  score: number;
  better: number;
  worse: number;
  same: number;
  errors: number;
  perTask: SkillFitnessTaskResult[];
  reason: string;
}

export interface SkillFitnessOpts {
  /** Fraction of tasks that must improve to pass (default 0.5 — at least half). */
  minImprovedFraction?: number;
  /** Max tasks the skill may regress and still pass (default 0 — zero regressions). */
  maxRegressions?: number;
  /** Cap tasks actually run, to bound live-SDK cost (each = 2 runner + 1 judge call). Default 12. */
  maxTasks?: number;
}

/**
 * Paired-eval a candidate skill. Conservative bar for AUTONOMOUS apply: zero
 * regressions AND at least `minImprovedFraction` of tasks improved. Anything
 * below this is not a failure of the skill per se — it falls to the human
 * approve-queue (phase 3), it just doesn't auto-apply.
 */
export async function evaluateSkillFitness(
  skill: Skill,
  tasks: SkillEvalTask[],
  runner: SkillRunner,
  judge: SkillJudge,
  opts: SkillFitnessOpts = {}
): Promise<SkillFitnessVerdict> {
  const minImprovedFraction = opts.minImprovedFraction ?? 0.5;
  const maxRegressions = opts.maxRegressions ?? 0;
  const maxTasks = opts.maxTasks ?? 12;
  if (!tasks.length) {
    return { pass: false, score: 0, better: 0, worse: 0, same: 0, errors: 0, perTask: [], reason: "no eval tasks" };
  }
  // Bound live-SDK cost: each task is 2 runner calls + 1 judge call.
  const runTasks = tasks.slice(0, maxTasks);

  const perTask: SkillFitnessTaskResult[] = [];
  for (const task of runTasks) {
    try {
      const baseline = await runner(task.prompt, null);
      const withSkill = await runner(task.prompt, skill);
      const { verdict, note } = await judge(task, baseline, withSkill);
      perTask.push({ id: task.id, verdict, note });
    } catch (err) {
      perTask.push({ id: task.id, verdict: "error", note: err instanceof Error ? err.message : String(err) });
    }
  }

  const better = perTask.filter((r) => r.verdict === "better").length;
  const worse = perTask.filter((r) => r.verdict === "worse").length;
  const same = perTask.filter((r) => r.verdict === "same").length;
  const errors = perTask.filter((r) => r.verdict === "error").length;
  const n = runTasks.length;
  const score = (better - worse) / n;
  const needImproved = Math.ceil(n * minImprovedFraction);

  let pass = true;
  let reason: string;
  if (errors > 0) {
    pass = false;
    reason = `${errors}/${n} task(s) errored — inconclusive, not auto-applying`;
  } else if (worse > maxRegressions) {
    pass = false;
    reason = `regressed ${worse} task(s) (max ${maxRegressions}) — not auto-applying`;
  } else if (better < needImproved) {
    pass = false;
    reason = `improved ${better}/${n} (need ≥${needImproved}) — below auto-apply bar`;
  } else {
    reason = `improved ${better}/${n}, regressed ${worse} — clears auto-apply bar`;
  }

  return { pass, score, better, worse, same, errors, perTask, reason };
}
