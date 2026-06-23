/**
 * SDK-backed runner + judge for the skill fitness gate (I-98 L1, phase 2b).
 * `evaluateSkillFitness` (skillFitness.ts) is engine-agnostic and injects these.
 *
 * Both run the agent through `runPrompt` in read-only, non-persisted mode: the
 * candidate skill is injected as a context block (it isn't on disk yet — it's a
 * proposal), and the eval must never mutate prod, so all write/bash/memory-write
 * tools are denied. As with the proposer, read-only is only *enforced* on the
 * claude-agent engine; callers gate to that engine before using these.
 */
import { runPrompt } from "./run.js";
import type { Skill } from "./skills.js";
import type { SkillRunner, SkillJudge, PairedVerdict, SkillEvalTask } from "./skillFitness.js";

export interface FitnessRunnerContext {
  dir: string;
  /** Must be "claude-agent" — read-only enforcement (disallowedTools) only works there. */
  engine: string;
  auth?: string;
  model?: string;
}

/**
 * Fail fast unless the engine is claude-agent. Read-only is enforced ONLY there
 * (cursor silently ignores disallowedTools), so a live eval on any other engine
 * could mutate prod. A code-level backstop, not just a caller convention.
 */
function assertReadOnlyEngine(ctx: FitnessRunnerContext): void {
  if (ctx.engine !== "claude-agent") {
    throw new Error(
      `skill fitness eval requires the claude-agent engine for read-only enforcement (got: ${ctx.engine || "default"})`
    );
  }
}

/** Same read-only denylist the evolution proposer uses — the eval observes, never mutates. */
export const READONLY_EVAL_TOOLS = [
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
  "mcp__csagent-memory__memory_save",
  "mcp__csagent-memory__memory_fact_add",
  "mcp__csagent-memory__memory_fact_invalidate",
];

/** Render a candidate skill as the context block a real skill injection would produce. */
export function skillContextBlock(skill: Skill): string {
  const desc = skill.description ? `${skill.description}\n\n` : "";
  return `# Skill available: ${skill.name}\n${desc}${skill.content}`.trim();
}

/** Stable 0/1 swap per task id so the judge can't learn "B is always the skill one". */
export function judgeOrderSwap(taskId: string): boolean {
  let h = 0;
  for (const ch of taskId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2 === 1;
}

export function buildJudgePrompt(task: SkillEvalTask, first: string, second: string): string {
  return [
    "You are grading two answers to the same task against a rubric. Judge ONLY on rubric merit —",
    "the order of the answers is randomized and carries no signal.",
    "",
    `## Task\n${task.prompt}`,
    "",
    `## Rubric (what 'good' looks like)\n${task.rubric}`,
    "",
    `## Answer 1\n${first || "(empty)"}`,
    "",
    `## Answer 2\n${second || "(empty)"}`,
    "",
    "On the FIRST line output exactly one token: `1` (Answer 1 better), `2` (Answer 2 better), or `tie`.",
    "On the SECOND line, one short sentence of justification.",
  ].join("\n");
}

/** Parse the judge's reply: first token ∈ {1,2,tie}; rest is the note. */
export function parseJudgeReply(raw: string): { pick: "1" | "2" | "tie"; note: string } {
  const text = (raw ?? "").trim();
  const firstLine = text.split("\n")[0]?.trim().toLowerCase() ?? "";
  const note = text.split("\n").slice(1).join(" ").trim().slice(0, 180);
  const m = firstLine.match(/^(1|2|tie)\b/);
  const pick = (m?.[1] as "1" | "2" | "tie") ?? "tie";
  return { pick, note: note || firstLine.slice(0, 180) };
}

export function makeSkillRunner(ctx: FitnessRunnerContext): SkillRunner {
  assertReadOnlyEngine(ctx);
  return async (prompt, skill) => {
    const text = skill ? `${skillContextBlock(skill)}\n\n---\n\n# Task\n${prompt}` : prompt;
    const r = await runPrompt(text, {
      dir: ctx.dir,
      barePrompt: true,
      attachMcp: false,
      persistRun: false,
      quiet: true,
      channel: "cron",
      engine: ctx.engine,
      auth: ctx.auth,
      model: ctx.model,
      disallowedTools: READONLY_EVAL_TOOLS,
    });
    return r.text ?? "";
  };
}

/** Map the judge's positional pick back to the with-skill answer, undoing the swap. */
export function mapJudgeToVerdict(pick: "1" | "2" | "tie", swap: boolean): PairedVerdict {
  if (pick === "tie") return "same";
  const withSkillPos = swap ? "1" : "2"; // where the with-skill answer was placed
  return pick === withSkillPos ? "better" : "worse";
}

export function makeSkillJudge(ctx: FitnessRunnerContext): SkillJudge {
  assertReadOnlyEngine(ctx);
  return async (task: SkillEvalTask, baseline: string, withSkill: string) => {
    const swap = judgeOrderSwap(task.id);
    const [first, second] = swap ? [withSkill, baseline] : [baseline, withSkill];
    const r = await runPrompt(buildJudgePrompt(task, first, second), {
      dir: ctx.dir,
      barePrompt: true,
      attachMcp: false,
      persistRun: false,
      quiet: true,
      channel: "cron",
      engine: ctx.engine,
      auth: ctx.auth,
      model: ctx.model,
      disallowedTools: READONLY_EVAL_TOOLS,
    });
    const { pick, note } = parseJudgeReply(r.text ?? "");
    return { verdict: mapJudgeToVerdict(pick, swap), note };
  };
}
