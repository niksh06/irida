import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDigestFollowup } from "../src/gatewayDigestFollowup.js";

test("parseDigestFollowup top-N variants", () => {
  assert.equal(parseDigestFollowup("топ-50")?.label, "top-50");
  assert.equal(parseDigestFollowup("top 50")?.label, "top-50");
  assert.equal(parseDigestFollowup("top-15")?.label, "top-15");
  assert.match(parseDigestFollowup("топ-50")!.prompt, /top-50/);
});

test("parseDigestFollowup sphere filters", () => {
  assert.equal(parseDigestFollowup("только InfoSec")?.label, "filter:InfoSec");
  assert.equal(parseDigestFollowup("only AI")?.label, "filter:AI");
  assert.match(parseDigestFollowup("только DevSecOps")!.prompt, /DevSecOps/);
});

test("parseDigestFollowup returns null for normal chat", () => {
  assert.equal(parseDigestFollowup("привет"), null);
  assert.equal(parseDigestFollowup("что нового в kafka?"), null);
});
