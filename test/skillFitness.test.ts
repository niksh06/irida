import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  evaluateSkillFitness,
  loadSkillEvalTasks,
  type SkillEvalTask,
  type SkillRunner,
  type SkillJudge,
  type PairedVerdict,
} from "../src/skillFitness.js";
import type { Skill } from "../src/skills.js";

const SKILL: Skill = { name: "s", description: "d", tags: [], content: "c", path: "p", provenance: "agent" };
const TASKS: SkillEvalTask[] = [
  { id: "t1", prompt: "p1", rubric: "r1" },
  { id: "t2", prompt: "p2", rubric: "r2" },
  { id: "t3", prompt: "p3", rubric: "r3" },
  { id: "t4", prompt: "p4", rubric: "r4" },
];

// runner tags whether the skill was injected, so the judge can be scripted per task.
const runner: SkillRunner = async (_p, skill) => (skill ? "WITH" : "BASE");

/** Judge driven by a per-task verdict map. */
function scriptedJudge(map: Record<string, PairedVerdict>): SkillJudge {
  return async (task) => ({ verdict: map[task.id] ?? "same", note: `scripted ${task.id}` });
}

test("clears the bar: zero regressions + majority improved → pass", async () => {
  const v = await evaluateSkillFitness(
    SKILL,
    TASKS,
    runner,
    scriptedJudge({ t1: "better", t2: "better", t3: "same", t4: "same" })
  );
  assert.equal(v.pass, true);
  assert.equal(v.better, 2);
  assert.equal(v.worse, 0);
  assert.equal(v.score, 0.5);
  assert.match(v.reason, /clears auto-apply bar/);
});

test("any regression fails the autonomous bar (defaults: maxRegressions 0)", async () => {
  const v = await evaluateSkillFitness(
    SKILL,
    TASKS,
    runner,
    scriptedJudge({ t1: "better", t2: "better", t3: "better", t4: "worse" })
  );
  assert.equal(v.pass, false);
  assert.equal(v.worse, 1);
  assert.match(v.reason, /regressed 1/);
});

test("too few improved → below bar (need ≥ half)", async () => {
  const v = await evaluateSkillFitness(
    SKILL,
    TASKS,
    runner,
    scriptedJudge({ t1: "better", t2: "same", t3: "same", t4: "same" })
  );
  assert.equal(v.pass, false);
  assert.match(v.reason, /below auto-apply bar/);
});

test("a runner/judge error makes the verdict inconclusive (no auto-apply)", async () => {
  const throwingRunner: SkillRunner = async (_p, skill) => {
    if (skill) throw new Error("sdk boom");
    return "BASE";
  };
  const v = await evaluateSkillFitness(SKILL, TASKS, throwingRunner, scriptedJudge({}));
  assert.equal(v.pass, false);
  assert.equal(v.errors, 4);
  assert.match(v.reason, /errored/);
});

test("empty task set never auto-applies", async () => {
  const v = await evaluateSkillFitness(SKILL, [], runner, scriptedJudge({}));
  assert.equal(v.pass, false);
  assert.match(v.reason, /no eval tasks/);
});

test("maxRegressions can be relaxed but still requires the improvement floor", async () => {
  const v = await evaluateSkillFitness(
    SKILL,
    TASKS,
    runner,
    scriptedJudge({ t1: "better", t2: "better", t3: "better", t4: "worse" }),
    { maxRegressions: 1 }
  );
  assert.equal(v.pass, true);
  assert.equal(v.score, 0.5); // (3-1)/4
});

test("loadSkillEvalTasks parses a valid file and rejects an empty/missing one", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "skillfit-"));
  try {
    const p = join(dir, "tasks.json");
    writeFileSync(p, JSON.stringify({ version: 1, tasks: [{ id: "a", prompt: "x", rubric: "y" }] }));
    const f = loadSkillEvalTasks(p);
    assert.equal(f.tasks.length, 1);
    assert.equal(f.tasks[0]!.id, "a");

    writeFileSync(p, JSON.stringify({ version: 1, tasks: [] }));
    assert.throws(() => loadSkillEvalTasks(p), /no valid tasks/);
    assert.throws(() => loadSkillEvalTasks(join(dir, "nope.json")), /missing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the shipped curated task set loads and has ≥5 tasks (Goodhart-guarded eval graph)", () => {
  const f = loadSkillEvalTasks();
  assert.ok(f.tasks.length >= 5, `expected ≥5 curated tasks, got ${f.tasks.length}`);
  for (const t of f.tasks) {
    assert.ok(t.id && t.prompt && t.rubric, `task ${t.id} fully specified`);
  }
});
