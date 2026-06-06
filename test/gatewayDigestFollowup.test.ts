import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDigestFollowupTurn,
  parseDigestFollowup,
} from "../src/gatewayDigestFollowup.js";

test("parseDigestFollowup maps только devops to DevOps topic", () => {
  const f = parseDigestFollowup("только devops");
  assert.ok(f);
  assert.match(f!.prompt, /DevOps/);
  assert.equal(f!.label, "filter:DevOps");
});

test("parseDigestFollowup maps only aisec", () => {
  const f = parseDigestFollowup("only aisec");
  assert.ok(f);
  assert.match(f!.prompt, /AISec/);
});

test("buildDigestFollowupTurn prepends digest context", () => {
  const turn = buildDigestFollowupTurn("[digest-followup] expand", "[digest-context] snippet\n\n");
  assert.match(turn, /^\[digest-context\]/);
  assert.match(turn, /expand/);
});
