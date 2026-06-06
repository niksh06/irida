import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseSessionTabHotkey,
  sessionAtTabIndex,
  visibleTabSessions,
} from "../src/tui/sessionTabs.js";
import type { SessionRecord } from "../src/store.js";

function sess(id: string): SessionRecord {
  return {
    id,
    title: id,
    cwd: "/a",
    runtime: "local",
    updated_at: "",
    last_status: "ok",
  };
}

describe("sessionTabs", () => {
  it("parseSessionTabHotkey maps 1-5", () => {
    assert.equal(parseSessionTabHotkey("1"), 0);
    assert.equal(parseSessionTabHotkey("5"), 4);
    assert.equal(parseSessionTabHotkey("6"), null);
    assert.equal(parseSessionTabHotkey("a"), null);
  });

  it("visibleTabSessions caps at five", () => {
    const list = Array.from({ length: 8 }, (_, i) => sess(`s${i}`));
    assert.equal(visibleTabSessions(list).length, 5);
  });

  it("sessionAtTabIndex returns visible session", () => {
    const list = [sess("a"), sess("b")];
    assert.equal(sessionAtTabIndex(list, 0)?.id, "a");
    assert.equal(sessionAtTabIndex(list, 1)?.id, "b");
    assert.equal(sessionAtTabIndex(list, 2), null);
  });
});
