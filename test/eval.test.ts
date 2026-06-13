import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEvalManifest, runEvalBattery, runEvalCase, evalRoot } from "../src/eval_cmd.js";

test("loadEvalManifest reads cases", () => {
  const manifest = loadEvalManifest(evalRoot());
  assert.ok(manifest.cases.length >= 1);
  assert.ok(manifest.cases.some((c) => c.id === "memory-audit-smoke"));
});

test("runEvalCase memory-audit-smoke passes", () => {
  const r = runEvalCase("memory-audit-smoke");
  assert.equal(r.ok, true, r.detail);
});

test("runEvalBattery runs all cases", () => {
  const r = runEvalBattery();
  assert.equal(r.ok, true);
  assert.ok(r.results.every((x) => x.ok));
});
