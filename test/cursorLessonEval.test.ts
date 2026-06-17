import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatLessonEvalFactObject,
  loadLessonEvalTasks,
  parseLessonEvalVerdict,
  recordLessonEval,
  validateLessonEvalScaffold,
  validateLessonEvalTasks,
} from "../src/cursorLessonEval.js";
import { evalRoot, runEvalCase } from "../src/eval_cmd.js";

test("loadLessonEvalTasks has ≥5 promote-aligned tasks", () => {
  const tasks = loadLessonEvalTasks();
  assert.ok(tasks.tasks.length >= 5);
});

test("validateLessonEvalScaffold passes for repo promote list", () => {
  const r = validateLessonEvalScaffold(evalRoot() + "/..");
  assert.equal(r.ok, true, r.errors.join("; "));
});

test("validateLessonEvalTasks rejects unknown lesson", () => {
  const tasks = loadLessonEvalTasks();
  const r = validateLessonEvalTasks(
    { version: 1, tasks: [{ ...tasks.tasks[0]!, lesson: "lesson.missing" }] },
    ["lesson.gateway-idle-rotation"]
  );
  assert.equal(r.ok, false);
});

test("parseLessonEvalVerdict accepts pass fail neutral", () => {
  assert.equal(parseLessonEvalVerdict("pass"), "pass");
  assert.equal(parseLessonEvalVerdict("FAIL"), "fail");
  assert.equal(parseLessonEvalVerdict("nope"), undefined);
});

test("formatLessonEvalFactObject appends note", () => {
  assert.equal(formatLessonEvalFactObject("pass"), "pass");
  assert.match(formatLessonEvalFactObject("fail", "no lift"), /^fail: no lift/);
});

test("recordLessonEval writes cursor_lesson_eval fact", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lesson-eval-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  const fact = await recordLessonEval(dir, "lesson.gateway-idle-rotation", "pass", "baseline ok");
  assert.match(fact.object, /^pass: baseline ok/);
});

test("runEvalCase cursor-lesson-paired passes", () => {
  const r = runEvalCase("cursor-lesson-paired");
  assert.equal(r.ok, true, r.detail);
});
