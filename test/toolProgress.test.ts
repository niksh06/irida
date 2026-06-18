import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatToolProgressLine,
  isStreamToolProgressPlaceholder,
  shouldInjectToolProgressIntoStream,
} from "../src/tui/toolProgress.js";

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

test("shouldInjectToolProgressIntoStream skips synthetic thinking", () => {
  assert.equal(
    shouldInjectToolProgressIntoStream({
      label: "thinking…",
      kind: "other",
      command: "waiting for model",
      phase: "call",
    }),
    false
  );
  assert.equal(
    shouldInjectToolProgressIntoStream({
      label: "shell",
      kind: "tool",
      toolName: "shell",
      command: "npm test",
      phase: "call",
    }),
    true
  );
});

test("isStreamToolProgressPlaceholder detects one-line strip prefix", () => {
  assert.equal(isStreamToolProgressPlaceholder("⚙ thinking…: waiting for model"), true);
  assert.equal(isStreamToolProgressPlaceholder("Hello"), false);
  assert.equal(isStreamToolProgressPlaceholder("⚙ shell: npm test\nDone"), false);
});
