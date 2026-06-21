import assert from "node:assert/strict";
import { describe, it } from "node:test";
import stringWidth from "string-width";
import { thinkingSpinner, thinkingWave } from "../src/tui/components/ThinkingBar.js";

describe("ThinkingBar animation (pure)", () => {
  it("spinner cycles through 10 braille frames and is 1 display cell", () => {
    const seen = new Set<string>();
    for (let t = 0; t < 10; t++) {
      const g = thinkingSpinner(t);
      assert.equal(stringWidth(g), 1, `spinner "${g}"`);
      seen.add(g);
    }
    assert.equal(seen.size, 10, "all 10 frames distinct");
    assert.equal(thinkingSpinner(10), thinkingSpinner(0), "wraps");
  });

  it("wave drifts and is a stable display width", () => {
    const widths = new Set<number>();
    for (let t = 0; t < 4; t++) widths.add(stringWidth(thinkingWave(t)));
    assert.deepEqual([...widths], [5], "all wave frames 5 cells");
    assert.notEqual(thinkingWave(0), thinkingWave(1), "animates");
    assert.equal(thinkingWave(4), thinkingWave(0), "wraps");
  });

  it("handles negative/zero ticks without crashing (wraps cleanly)", () => {
    assert.equal(thinkingSpinner(-1), thinkingSpinner(9));
    assert.equal(thinkingSpinner(0), thinkingSpinner(10));
    assert.equal(thinkingWave(-1), thinkingWave(3));
  });
});
