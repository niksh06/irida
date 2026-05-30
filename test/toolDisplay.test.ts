import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeCommandForBar,
  truncateCommandForBanner,
  commandLineCount,
} from "../src/tui/toolDisplay.js";

describe("toolDisplay", () => {
  it("summarizes multiline heredoc to one line", () => {
    const cmd = "python3 << 'PY'\nimport json\nprint(1)\nPY";
    const s = summarizeCommandForBar(cmd);
    assert.ok(!s.includes("\n"));
    assert.match(s, /lines\)/);
  });

  it("truncates banner to max lines", () => {
    const cmd = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const { text, truncated, totalLines } = truncateCommandForBanner(cmd, 8);
    assert.equal(truncated, true);
    assert.equal(totalLines, 20);
    assert.match(text, /more lines/);
    assert.ok(text.split("\n").length <= 9);
  });

  it("counts lines", () => {
    assert.equal(commandLineCount("a\nb\nc"), 3);
  });
});
