import { test } from "node:test";
import assert from "node:assert/strict";
import { TPARSE_DAILY_TOPICS, topicTagHintLine } from "../src/tparserTopics.js";

test("TPARSE_DAILY_TOPICS has five buckets", () => {
  assert.equal(TPARSE_DAILY_TOPICS.length, 5);
  const ids = TPARSE_DAILY_TOPICS.map((t) => t.id);
  assert.deepEqual(ids, ["ai-ml", "aisec-mlsec", "infosec", "programming", "devsecops-devops"]);
});

test("topicTagHintLine joins hints", () => {
  const line = topicTagHintLine(TPARSE_DAILY_TOPICS[0]!);
  assert.match(line, /AI/);
  assert.match(line, /LLM/);
});
