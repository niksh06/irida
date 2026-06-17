import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEvalManifest, runEvalBattery, runEvalCase, evalRoot } from "../src/eval_cmd.js";

test("loadEvalManifest reads cases", () => {
  const manifest = loadEvalManifest(evalRoot());
  assert.ok(manifest.cases.length >= 2);
  assert.ok(manifest.cases.some((c) => c.id === "memory-audit-smoke"));
  assert.ok(manifest.cases.some((c) => c.id === "memory-search-smoke"));
  assert.ok(manifest.cases.some((c) => c.id === "cursor-lesson-paired"));
});

test("runEvalCase memory-audit-smoke passes", () => {
  const r = runEvalCase("memory-audit-smoke");
  assert.equal(r.ok, true, r.detail);
});

test("runEvalCase memory-search-smoke passes", () => {
  const r = runEvalCase("memory-search-smoke");
  assert.equal(r.ok, true, r.detail);
});

test("runEvalCase cursor-lesson-paired passes", () => {
  const r = runEvalCase("cursor-lesson-paired");
  assert.equal(r.ok, true, r.detail);
});

test("runEvalBattery runs all cases", () => {
  const r = runEvalBattery();
  assert.equal(r.ok, true);
  assert.ok(r.results.every((x) => x.ok));
});
