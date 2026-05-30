import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { useAltScreen } from "../src/tui/terminal.js";

describe("tui terminal", () => {
  it("alt screen is opt-in via CSAGENT_TUI_ALT=1", () => {
    const prev = process.env.CSAGENT_TUI_ALT;
    try {
      delete process.env.CSAGENT_TUI_ALT;
      assert.equal(useAltScreen(), false);
      process.env.CSAGENT_TUI_ALT = "1";
      assert.equal(useAltScreen(), true);
    } finally {
      if (prev === undefined) delete process.env.CSAGENT_TUI_ALT;
      else process.env.CSAGENT_TUI_ALT = prev;
    }
  });
});
