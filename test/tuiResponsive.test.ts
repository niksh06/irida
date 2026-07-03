import { describe, it } from "node:test";
import assert from "node:assert/strict";
import stringWidth from "string-width";
import { readTerminalSize } from "../src/tui/terminal.js";
import { estimateVisibleLines, wrapToWidth } from "../src/tui/transcript.js";
import { bannerFor, compactBanner, COMPACT_BANNER_COLS } from "../src/tui/theme.js";

// I-156: TUI responsiveness. The reactive hook (useTerminalSize) needs a React
// renderer to exercise; here we pin its pure core + the width-driven helpers.

describe("readTerminalSize (I-156)", () => {
  it("reads live values and falls back for a missing/zero size", () => {
    const stdout = { columns: 120, rows: 40 };
    assert.deepEqual(readTerminalSize(stdout), { cols: 120, rows: 40 });
    // Mutating the stream and re-reading yields the NEW size (resize contract).
    stdout.columns = 100;
    stdout.rows = 30;
    assert.deepEqual(readTerminalSize(stdout), { cols: 100, rows: 30 });
    assert.deepEqual(readTerminalSize({ columns: 0, rows: 0 }), { cols: 80, rows: 24 });
    assert.deepEqual(readTerminalSize(undefined), { cols: 80, rows: 24 });
  });
});

describe("estimateVisibleLines chrome (I-156)", () => {
  it("subtracts measured chrome instead of a fixed guess", () => {
    assert.equal(estimateVisibleLines(40, 12), 28);
    assert.equal(estimateVisibleLines(40, 20), 20);
    // Never collapses below the 6-line floor, even with huge chrome / tiny term.
    assert.equal(estimateVisibleLines(10, 30), 6);
    // Back-compat default keeps old callers stable.
    assert.equal(estimateVisibleLines(40), 40 - 11);
  });
});

describe("wrapToWidth display-width (I-156b)", () => {
  const budget = (w: number) => Math.max(16, w - 8);
  const fits = (text: string, w: number) =>
    wrapToWidth(text, w).every((l) => stringWidth(l) <= budget(w));

  it("never overflows the budget for emoji / CJK / mixed (measured by cells)", () => {
    for (const w of [24, 40, 80]) {
      assert.ok(fits("✨".repeat(60), w), `emoji @${w}`);
      assert.ok(fits("你好世界".repeat(20), w), `cjk @${w}`);
      assert.ok(fits("план ✨ 你好 rebalance the terminal layout properly now", w), `mixed @${w}`);
      assert.ok(fits("supercalifragilisticexpialidocious".repeat(3), w), `longword @${w}`);
    }
  });

  it("still word-wraps ASCII on spaces (no mid-word breaks when it fits)", () => {
    const lines = wrapToWidth("the quick brown fox jumps over the lazy dog", 24);
    assert.ok(lines.length >= 2);
    // No line ends mid-word with a dangling partial that a space would've broken.
    for (const l of lines) assert.equal(l, l.replace(/\s+$/, ""), "no trailing space");
  });

  it("preserves explicit newlines as separate lines", () => {
    assert.deepEqual(wrapToWidth("a\n\nb", 40), ["a", "", "b"]);
  });
});

describe("bannerFor (I-156)", () => {
  it("uses the compact one-liner below the width threshold, box above", () => {
    assert.equal(bannerFor(COMPACT_BANNER_COLS - 1), compactBanner);
    const wide = bannerFor(120);
    assert.ok(wide.includes("╭") && wide.includes("╯"), "wide banner is the box");
    assert.ok(!wide.startsWith("\n"), "leading newline stripped so the box hugs the top");
    // The compact banner is a single line; the box is multi-line.
    assert.equal(compactBanner.includes("\n"), false);
    assert.ok(bannerFor(120).split("\n").length >= 3);
  });
});
