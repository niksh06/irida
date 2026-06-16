import { test } from "node:test";
import assert from "node:assert/strict";
import { reciprocalRankFusion, resolveHybridWeights } from "../src/memorySearchHybrid.js";

test("reciprocalRankFusion merges ranked lists", () => {
  const fts = [{ name: "a" }, { name: "b" }];
  const vec = [{ name: "b" }, { name: "a" }];
  const merged = reciprocalRankFusion(
    [
      { items: fts, weight: 1 },
      { items: vec, weight: 1 },
    ],
    2
  );
  assert.equal(merged.length, 2);
  assert.deepEqual(new Set(merged.map((n) => n.name)), new Set(["a", "b"]));
});

test("reciprocalRankFusion respects weights", () => {
  const fts = [{ name: "keyword-only" }];
  const vec = [{ name: "vector-only" }];
  const vecHeavy = reciprocalRankFusion(
    [
      { items: fts, weight: 1 },
      { items: vec, weight: 10 },
    ],
    1
  );
  assert.equal(vecHeavy[0]!.name, "vector-only");
});

test("resolveHybridWeights falls back to defaults", () => {
  assert.deepEqual(resolveHybridWeights(), { fts: 1, vector: 1 });
  assert.deepEqual(resolveHybridWeights({ fts: 0, vector: -1 }), { fts: 1, vector: 1 });
  assert.deepEqual(resolveHybridWeights({ fts: 2, vector: 0.5 }), { fts: 2, vector: 0.5 });
});
