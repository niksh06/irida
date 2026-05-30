import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  insertAt,
  moveCursor,
  cursorLineCol,
  visibleComposerLines,
  lineColToCursor,
  eraseBeforeCursor,
} from "../src/tui/multilineInput.js";
import { listContextRefs, probeContextRef } from "../src/contextRefs.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("multilineInput", () => {
  it("eraseBeforeCursor removes char before cursor (Mac backspace at EOL)", () => {
    const { value, cursor } = eraseBeforeCursor("hello", 5);
    assert.equal(value, "hell");
    assert.equal(cursor, 4);
  });

  it("inserts and moves across lines", () => {
    let v = "a";
    let c = 1;
    ({ value: v, cursor: c } = insertAt(v, c, "\nb"));
    assert.equal(v, "a\nb");
    assert.equal(c, 3);
    c = moveCursor(v, c, "up");
    assert.equal(cursorLineCol(v, c).line, 0);
  });

  it("lineCol roundtrip", () => {
    const v = "hello\nworld";
    const pos = lineColToCursor(v, 1, 3);
    assert.equal(v.slice(0, pos), "hello\nwor");
  });

  it("windows long drafts", () => {
    const v = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    const cursor = v.length;
    const view = visibleComposerLines(v, cursor, 4);
    assert.equal(view.lines.length, 4);
    assert.ok(view.hiddenAbove > 0);
  });
});

describe("listContextRefs", () => {
  it("lists and dedupes tokens", () => {
    const refs = listContextRefs("review @file:a.ts and @file:a.ts @dir:src");
    assert.equal(refs.length, 2);
    assert.equal(refs[0]!.kind, "file");
    assert.equal(refs[1]!.kind, "dir");
  });

  it("probes file existence", () => {
    const dir = mkdtempSync(join(tmpdir(), "csagent-v7-"));
    writeFileSync(join(dir, "x.txt"), "hi");
    const refs = listContextRefs("@file:x.txt");
    assert.equal(probeContextRef(dir, refs[0]!), "ok");
    assert.equal(probeContextRef(dir, listContextRefs("@file:nope")[0]!), "missing");
  });
});
