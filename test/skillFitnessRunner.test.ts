import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseJudgeReply,
  judgeOrderSwap,
  mapJudgeToVerdict,
  skillContextBlock,
  buildJudgePrompt,
  makeSkillRunner,
  makeSkillJudge,
} from "../src/skillFitnessRunner.js";
import type { Skill } from "../src/skills.js";

test("parseJudgeReply reads the first-line token and the note", () => {
  assert.deepEqual(parseJudgeReply("2\nThe second answer adds a retry caveat."), {
    pick: "2",
    note: "The second answer adds a retry caveat.",
  });
  assert.equal(parseJudgeReply("1 — clearer").pick, "1");
  assert.equal(parseJudgeReply("tie\nboth equivalent").pick, "tie");
  // garbage / no token → defaults to tie (inconclusive, won't fake a 'better')
  assert.equal(parseJudgeReply("hmm not sure").pick, "tie");
  assert.equal(parseJudgeReply("").pick, "tie");
});

test("judgeOrderSwap is stable per id and varies across ids", () => {
  assert.equal(judgeOrderSwap("flaky-shell-retry"), judgeOrderSwap("flaky-shell-retry"));
  // at least some ids differ in placement (not all the same constant)
  const swaps = ["a", "b", "c", "d", "e", "f"].map(judgeOrderSwap);
  assert.ok(new Set(swaps).size === 2, "swap distributes across both positions");
});

test("mapJudgeToVerdict undoes the swap so 'better' always means the skill helped", () => {
  // no swap → with-skill is Answer 2
  assert.equal(mapJudgeToVerdict("2", false), "better");
  assert.equal(mapJudgeToVerdict("1", false), "worse");
  // swapped → with-skill is Answer 1
  assert.equal(mapJudgeToVerdict("1", true), "better");
  assert.equal(mapJudgeToVerdict("2", true), "worse");
  // tie is position-independent
  assert.equal(mapJudgeToVerdict("tie", false), "same");
  assert.equal(mapJudgeToVerdict("tie", true), "same");
});

test("skillContextBlock renders name + description + content", () => {
  const skill: Skill = { name: "retry", description: "bound flaky cmds", tags: [], content: "use backoff", path: "p" };
  const block = skillContextBlock(skill);
  assert.match(block, /# Skill available: retry/);
  assert.match(block, /bound flaky cmds/);
  assert.match(block, /use backoff/);
});

test("the runner/judge factories refuse any engine but claude-agent (read-only backstop)", () => {
  assert.throws(() => makeSkillRunner({ dir: ".", engine: "cursor" }), /claude-agent/);
  assert.throws(() => makeSkillJudge({ dir: ".", engine: "" }), /claude-agent/);
  // claude-agent constructs fine (returns a function; no SDK call here)
  assert.equal(typeof makeSkillRunner({ dir: ".", engine: "claude-agent" }), "function");
  assert.equal(typeof makeSkillJudge({ dir: ".", engine: "claude-agent" }), "function");
});

test("buildJudgePrompt embeds task, rubric, both answers, and the verdict instruction", () => {
  const p = buildJudgePrompt({ id: "t", prompt: "do X", rubric: "good = Y" }, "answer one", "answer two");
  assert.match(p, /do X/);
  assert.match(p, /good = Y/);
  assert.match(p, /answer one/);
  assert.match(p, /answer two/);
  assert.match(p, /`1`.*`2`.*`tie`/s);
});
