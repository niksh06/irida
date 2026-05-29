import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSlash } from "../src/tui/slash.js";
import { viewportMessages } from "../src/tui/transcript.js";
import type { ChatMessage } from "../src/tui/types.js";

describe("tui slash", () => {
  it("parses help and sessions", () => {
    assert.deepEqual(parseSlash("/help"), { type: "help" });
    assert.deepEqual(parseSlash("/sessions"), { type: "sessions" });
  });

  it("parses resume with id", () => {
    assert.deepEqual(parseSlash("/resume sess-abc"), { type: "resume", sessionId: "sess-abc" });
  });

  it("returns null for normal text", () => {
    assert.equal(parseSlash("hello"), null);
  });
});

describe("tui transcript viewport", () => {
  const msgs: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    text: `line ${i}`,
  }));

  it("shows tail when scrollOffset is 0", () => {
    const v = viewportMessages(msgs, 4, 0);
    assert.equal(v.visible.length, 4);
    assert.equal(v.visible[0]?.text, "line 6");
    assert.equal(v.atBottom, true);
  });

  it("scrolls up with offset", () => {
    const v = viewportMessages(msgs, 4, 4);
    assert.equal(v.visible[0]?.text, "line 2");
    assert.equal(v.hiddenBelow, 4);
  });
});
