import { test } from "node:test";
import assert from "node:assert/strict";
import { formatToolProgressLine } from "../src/tui/toolProgress.js";

test("formatToolProgressLine shows tool and command", () => {
  const line = formatToolProgressLine({
    label: "shell",
    kind: "shell",
    toolName: "shell",
    command: "npm test",
    phase: "call",
  });
  assert.equal(line, "⚙ shell: npm test");
});

test("formatToolProgressLine ignores non-call phases", () => {
  assert.equal(
    formatToolProgressLine({ label: "done", kind: "shell", phase: "result", status: "ok" }),
    ""
  );
});
