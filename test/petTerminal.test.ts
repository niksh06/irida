import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveTuiPetState, petTerminalFrame } from "../src/petTerminal.js";

describe("deriveTuiPetState", () => {
  const now = 1_000_000;

  it("working when busy with tool call", () => {
    const state = deriveTuiPetState({
      busy: true,
      activityLog: [{ phase: "call", status: "running" }],
      lastTurnOk: false,
      lastTurnError: false,
      lastEventAtMs: now,
      nowMs: now,
    });
    assert.equal(state, "working");
  });
});

describe("petTerminalFrame", () => {
  it("animates working frames", () => {
    const a = petTerminalFrame("working", 0);
    const b = petTerminalFrame("working", 1);
    const ta = a.map((l) => l.parts.map((p) => p.t).join("")).join("|");
    const tb = b.map((l) => l.parts.map((p) => p.t).join("")).join("|");
    assert.notEqual(ta, tb);
  });

  it("idle has accent sparkles", () => {
    const frame = petTerminalFrame("idle", 0);
    const text = frame.flatMap((l) => l.parts).map((p) => p.t).join("");
    assert.match(text, /✦/);
    assert.match(text, /◉/);
  });
});
