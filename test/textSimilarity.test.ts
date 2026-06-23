import { test } from "node:test";
import assert from "node:assert/strict";
import { significantTokens, isNearDuplicate } from "../src/textSimilarity.js";

test("significantTokens drops stopwords + short words, dedupes", () => {
  assert.deepEqual(significantTokens("Add a startup-failure triage note"), ["startup", "failure", "triage"]);
  assert.deepEqual(significantTokens("irida gateway run"), []); // all stopwords/short
});

test("isNearDuplicate fires on strong token overlap", () => {
  assert.equal(isNearDuplicate("startup failure triage", "startup-failure triage playbook"), true); // coverage 1.0
  assert.equal(isNearDuplicate("engine model config resolution", "config model resolution field"), true); // jaccard 0.6
  assert.equal(isNearDuplicate("tparser news access digest", "tparser news digest access"), true); // identical set
});

test("isNearDuplicate stays high-precision — distinct titles do NOT match", () => {
  // differ-by-one-token (Jaccard 0.5, coverage 0.67) — below the bar, mirrors isDuplicateProposal
  assert.equal(isNearDuplicate("memory search ranking", "memory search latency"), false);
  assert.equal(isNearDuplicate("Add a startup-failure preflight note", "Add a startup-failure triage note"), false);
  // genuinely different topics
  assert.equal(isNearDuplicate("cache pgvector embeddings", "startup failure triage"), false);
  // too little signal (≥2 significant tokens required on both)
  assert.equal(isNearDuplicate("run gateway", "the irida note"), false);
});
