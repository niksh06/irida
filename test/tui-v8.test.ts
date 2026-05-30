import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  messagesToRowsCached,
  scrollPositionLabel,
  shouldVirtualizeTranscript,
  useNativeTrackpadScroll,
  viewportRows,
  type MessageRowCache,
} from "../src/tui/transcript.js";
import type { ChatMessage } from "../src/tui/types.js";

describe("tui v8 virtual scroll", () => {
  it("shouldVirtualize when transcript exceeds viewport", () => {
    assert.equal(shouldVirtualizeTranscript(50, 10), true);
    assert.equal(shouldVirtualizeTranscript(8, 10), false);
  });

  it("scrollPositionLabel shows line fraction", () => {
    assert.equal(scrollPositionLabel(100, 40, 10), "L50/100");
    assert.equal(scrollPositionLabel(5, 0, 10), null);
  });

  it("messagesToRowsCached reuses unchanged messages", () => {
    const cache: MessageRowCache = new Map();
    const msgs: ChatMessage[] = [
      { id: "m1", role: "user", text: "hello" },
      { id: "m2", role: "assistant", text: "world", streaming: true },
    ];
    const r1 = messagesToRowsCached(msgs, 60, cache);
    assert.equal(cache.size, 2);
    const r2 = messagesToRowsCached(
      [{ ...msgs[0]! }, { ...msgs[1]!, text: "world!" }],
      60,
      cache
    );
    assert.ok(r2.length >= r1.length);
    assert.equal(cache.get("m1")!.text, "hello");
    assert.equal(cache.get("m2")!.text, "world!");
  });

  it("useNativeTrackpadScroll when at bottom without alt screen", () => {
    assert.equal(
      useNativeTrackpadScroll({ altScreen: false, scrollLineOffset: 0, scrollMode: false }),
      true
    );
    assert.equal(
      useNativeTrackpadScroll({ altScreen: false, scrollLineOffset: 0, scrollMode: false, overlay: true }),
      false
    );
    assert.equal(
      useNativeTrackpadScroll({
        altScreen: false,
        scrollLineOffset: 0,
        scrollMode: false,
        holdNativeScroll: true,
      }),
      false
    );
    assert.equal(
      useNativeTrackpadScroll({ altScreen: false, scrollLineOffset: 5, scrollMode: false }),
      false
    );
    assert.equal(
      useNativeTrackpadScroll({ altScreen: true, scrollLineOffset: 0, scrollMode: false }),
      false
    );
  });

  it("viewport always caps visible rows", () => {
    const long = "word ".repeat(120).trim();
    const cache: MessageRowCache = new Map();
    const rows = messagesToRowsCached([{ id: "a", role: "assistant", text: long }], 50, cache);
    const v = viewportRows(rows, 8, 0);
    assert.equal(v.visible.length, 8);
    assert.ok(v.totalLines > 8);
  });
});
