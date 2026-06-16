import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitTranscriptForDistill, DEFAULT_DISTILL_CHUNK_CHARS } from "../src/cursorTranscriptSplit.js";

describe("splitTranscriptForDistill", () => {
  it("returns empty for blank body", () => {
    assert.deepEqual(splitTranscriptForDistill(""), []);
  });

  it("keeps small transcript as single chunk", () => {
    const body = "## User\n\nhello\n\n## Assistant\n\nworld";
    const chunks = splitTranscriptForDistill(body, 10_000);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.index, 0);
    assert.equal(chunks[0]!.total, 1);
    assert.match(chunks[0]!.text, /hello/);
  });

  it("splits on User/Assistant sections when over budget", () => {
    const section = "## User\n\n" + "x".repeat(80_000);
    const body = `${section}\n\n## Assistant\n\n${"y".repeat(80_000)}`;
    const chunks = splitTranscriptForDistill(body, DEFAULT_DISTILL_CHUNK_CHARS);
    assert.ok(chunks.length >= 2);
    assert.equal(chunks[0]!.total, chunks.length);
    for (let i = 0; i < chunks.length; i++) {
      assert.equal(chunks[i]!.index, i);
      assert.ok(Buffer.byteLength(chunks[i]!.text, "utf8") <= DEFAULT_DISTILL_CHUNK_CHARS + 200);
    }
  });
});
