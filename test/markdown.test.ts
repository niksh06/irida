import { describe, it } from "node:test";
import assert from "node:assert/strict";
import stringWidth from "string-width";
import { parseInline, renderMarkdown } from "../src/tui/markdown.js";

// I-156c: markdown → styled segments for the transcript. Plain projection must
// stay faithful (search/copy) and nothing may overflow the display width.

const styleOf = (text: string, seg: { text: string; style?: string }[]) =>
  seg.find((s) => s.text === text)?.style;

describe("parseInline (I-156c)", () => {
  it("styles bold, inline code, underscore italic; leaves raw markers out", () => {
    const segs = parseInline("do **bold** and `code` and _em_ here");
    assert.equal(styleOf("bold", segs), "bold");
    assert.equal(styleOf("code", segs), "code");
    assert.equal(styleOf("em", segs), "italic");
    const plain = segs.map((s) => s.text).join("");
    assert.equal(plain, "do bold and code and em here"); // markers stripped
  });

  it("code spans win over emphasis inside them", () => {
    const segs = parseInline("`a **b** c`");
    assert.equal(segs.length, 1);
    assert.equal(segs[0]!.style, "code");
    assert.equal(segs[0]!.text, "a **b** c");
  });

  it("single asterisks are NOT italic (bullets/globs/math stay literal)", () => {
    const segs = parseInline("run *.ts and 2 * 3");
    assert.ok(segs.every((s) => s.style !== "italic"));
    assert.equal(segs.map((s) => s.text).join(""), "run *.ts and 2 * 3");
  });

  it("unclosed markup (mid-stream) stays literal, never throws", () => {
    const segs = parseInline("half **bold and `code");
    assert.equal(segs.map((s) => s.text).join(""), "half **bold and `code");
    assert.ok(segs.every((s) => !s.style));
  });
});

describe("renderMarkdown (I-156c)", () => {
  const fits = (lines: { plain: string }[], w: number) =>
    lines.every((l) => stringWidth(l.plain) <= Math.max(16, w - 8));

  it("headings, bullets, quotes get markers; nothing overflows width", () => {
    const md = ["# Title", "- item one", "> quoted", "plain **tail**"].join("\n");
    for (const w of [24, 40, 80]) {
      const lines = renderMarkdown(md, w);
      assert.ok(fits(lines, w), `overflow @${w}`);
    }
    const lines = renderMarkdown(md, 80);
    assert.equal(lines[0]!.segments[0]!.style, "heading");
    assert.equal(lines[0]!.plain, "Title"); // '#' stripped
    assert.equal(lines[1]!.segments[0]!.style, "bullet");
    assert.ok(lines[1]!.plain.startsWith("• "));
    assert.equal(lines[2]!.segments[0]!.style, "quote");
  });

  it("fenced code blocks render verbatim (no inline parsing inside)", () => {
    const md = ["```", "x = **not bold** `not code`", "```"].join("\n");
    const lines = renderMarkdown(md, 80);
    // The content line keeps its raw asterisks/backticks and is styled codeblock.
    const body = lines.find((l) => l.plain.includes("not bold"));
    assert.ok(body);
    assert.equal(body!.plain, "x = **not bold** `not code`");
    assert.equal(body!.segments[0]!.style, "codeblock");
  });

  it("bullet continuation lines hang-indent under the text", () => {
    const long = "- " + "word ".repeat(30).trim();
    const lines = renderMarkdown(long, 30);
    assert.ok(lines.length >= 2);
    assert.ok(lines[0]!.plain.startsWith("• "));
    // Continuation is indented, not another bullet.
    assert.ok(lines[1]!.plain.startsWith("  "));
    assert.ok(!lines[1]!.plain.trimStart().startsWith("•"));
  });

  it("preserves blank lines and wide chars", () => {
    const lines = renderMarkdown("a\n\n✨✨✨ 你好", 20);
    assert.equal(lines[1]!.plain, "");
    assert.ok(lines.every((l) => stringWidth(l.plain) <= 12));
  });
});
