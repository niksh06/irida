import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyPetActivity,
  deriveTuiPetState,
  petTerminalFrame,
  petTerminalLabel,
} from "../src/petTerminal.js";

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

  it("every state keeps a single eye (one consistent character on the eye row)", () => {
    // The eye lives on row 2 (0-indexed), between the box sides │ … │.
    const EYES = /[◉‿◐◓◑◒◕^╥\-]/gu;
    for (const state of ["idle", "working", "happy", "sad", "sleep"] as const) {
      for (let tick = 0; tick < 4; tick++) {
        const eyeRow = petTerminalFrame(state, tick)[2]!.parts.map((p) => p.t).join("");
        const eyes = eyeRow.match(EYES) ?? [];
        assert.equal(eyes.length, 1, `${state}@${tick} eye row "${eyeRow}" should have exactly one eye`);
      }
    }
  });

  it("all frames are the same height (no vertical jump)", () => {
    for (const state of ["idle", "working", "happy", "sad", "sleep"] as const) {
      for (let tick = 0; tick < 4; tick++) {
        assert.equal(petTerminalFrame(state, tick).length, 5, `${state}@${tick}`);
      }
    }
  });
});

describe("classifyPetActivity", () => {
  it("buckets tools by name and kind", () => {
    assert.equal(classifyPetActivity("Read", "tool"), "read");
    assert.equal(classifyPetActivity("Edit", "tool"), "edit");
    assert.equal(classifyPetActivity("run_terminal_cmd", "tool"), "shell");
    assert.equal(classifyPetActivity("Grep", "tool"), "search");
    assert.equal(classifyPetActivity("anything", "mcp"), "mcp");
    assert.equal(classifyPetActivity(undefined, "tool"), "tool");
  });

  it("contextual working label reflects the active tool", () => {
    assert.equal(petTerminalLabel("working", "read"), "wisp · reading…");
    assert.equal(petTerminalLabel("working"), "wisp · thinking…");
    assert.equal(petTerminalLabel("idle", "read"), "wisp · watching");
  });

  it("working frame shows the activity glyph in the tail, stays 5 lines", () => {
    const frame = petTerminalFrame("working", 0, "search");
    assert.equal(frame.length, 5);
    const tail = frame[frame.length - 1]!.parts.map((p) => p.t).join("");
    assert.match(tail, /⌕/);
    // generic "tool" keeps the baked-in ⚡/≋ pulse, no override
    const generic = petTerminalFrame("working", 0, "tool");
    const genTail = generic[generic.length - 1]!.parts.map((p) => p.t).join("");
    assert.doesNotMatch(genTail, /⌕/);
  });
});
