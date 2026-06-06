import { test } from "node:test";
import assert from "node:assert/strict";
import { inferServiceLogLevel } from "../src/serviceLog.js";

test("inferServiceLogLevel routes poll errors to stderr", () => {
  assert.equal(
    inferServiceLogLevel("[gateway] telegram poll error (#3): Bad Gateway"),
    "error"
  );
  assert.equal(inferServiceLogLevel("[chat] sendTurn ok status=finished"), "info");
  assert.equal(inferServiceLogLevel("[chat] sendTurn failed (no retry) x"), "error");
  assert.equal(inferServiceLogLevel("[gateway] telegram poll ok (heartbeat)"), "info");
});
