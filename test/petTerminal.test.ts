import assert from "node:assert/strict";
import { describe, it } from "node:test";
import stringWidth from "string-width";

import {
  classifyPetActivity,
  deriveTuiPetState,
  petTerminalFrame,
  petTerminalLabel,
  petActivityGlyph,
  PET_WISP_FRAMES,
} from "../src/petTerminal.js";

const STATES = ["idle", "working", "happy", "sad", "sleep"] as const;
/** Iterate every frame of a state (self-maintaining as animations grow). */
const eachFrame = (fn: (state: (typeof STATES)[number], tick: number) => void) => {
  for (const state of STATES) for (let tick = 0; tick < PET_WISP_FRAMES[state].length; tick++) fn(state, tick);
};

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

  it("idle has accent sparkles and an eye", () => {
    const frame = petTerminalFrame("idle", 0);
    const text = frame.flatMap((l) => l.parts).map((p) => p.t).join("");
    assert.match(text, /✦/);
    const eye = frame[2]!.parts.map((p) => p.t).join("");
    assert.match(eye, /[◉◎◐◑‿]/); // idle's eye glances/blinks, so don't pin one glyph
  });

  it("idle eye TRACKS the sparkle (left→◐, right→◑) and blinks + peeks", () => {
    let sawLeft = false;
    let sawRight = false;
    for (const frame of PET_WISP_FRAMES.idle) {
      const row0 = frame[0]!.parts.map((p) => p.t).join("");
      const eye = frame[2]!.parts.map((p) => p.t).join("");
      const sparkle = [...row0].indexOf("✦"); // ~column; blink/peek frames have none
      if (sparkle === -1) continue;
      if (sparkle <= 1) {
        assert.match(eye, /◐/, `sparkle@${sparkle} (left) → eye should look left`);
        sawLeft = true;
      }
      if (sparkle >= 6) {
        assert.match(eye, /◑/, `sparkle@${sparkle} (right) → eye should look right`);
        sawRight = true;
      }
    }
    assert.ok(sawLeft && sawRight, "idle should glance both ways as the sparkle drifts");
    const eyes = PET_WISP_FRAMES.idle.map((f) => f[2]!.parts.map((p) => p.t).join(""));
    assert.ok(eyes.some((e) => /‿/.test(e)), "idle blinks");
    assert.ok(eyes.some((e) => /◎/.test(e)), "idle has a curious wide-eye peek");
  });

  it("every state keeps a single eye (one consistent character on the eye row)", () => {
    // The eye lives on row 2 (0-indexed), between the box sides │ … │.
    const EYES = /[◉◎‿◐◓◑◒◕◠^╥\-]/gu;
    eachFrame((state, tick) => {
      const eyeRow = petTerminalFrame(state, tick)[2]!.parts.map((p) => p.t).join("");
      const eyes = eyeRow.match(EYES) ?? [];
      assert.equal(eyes.length, 1, `${state}@${tick} eye row "${eyeRow}" should have exactly one eye`);
    });
  });

  it("all frames are the same height (no vertical jump)", () => {
    eachFrame((state, tick) => {
      assert.equal(petTerminalFrame(state, tick).length, 5, `${state}@${tick}`);
    });
  });

  it("every row is exactly 8 DISPLAY columns wide (no horizontal jump)", () => {
    // Measure with string-width, not code points: a 2-cell glyph (e.g. ⚡) is one
    // code point but two terminal columns, which would jitter the corner in Ink.
    eachFrame((state, tick) => {
      for (const [i, line] of petTerminalFrame(state, tick).entries()) {
        const text = line.parts.map((p) => p.t).join("");
        assert.equal(stringWidth(text), 8, `${state}@${tick} row${i} "${text}"`);
      }
    });
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

  it("petActivityGlyph maps each category to its icon (shared with the activity strip)", () => {
    assert.equal(petActivityGlyph(classifyPetActivity("Grep", "tool")), "⌕");
    assert.equal(petActivityGlyph(classifyPetActivity("Edit", "tool")), "✎");
    assert.equal(petActivityGlyph(classifyPetActivity("Read", "tool")), "▤");
    assert.equal(petActivityGlyph(classifyPetActivity("run_terminal_cmd", "tool")), "›_");
    assert.equal(petActivityGlyph(classifyPetActivity("x", "mcp")), "⇄");
    // generic / unknown tool falls back to the 1-cell energy glyph
    assert.equal(petActivityGlyph(classifyPetActivity("WeirdTool", "tool")), "ϟ");
    assert.equal(petActivityGlyph(classifyPetActivity(undefined, "other")), "ϟ");
  });

  it("activity thought line stays 8 columns for every tool (incl. 2-cell shell glyph)", () => {
    for (const activity of ["shell", "read", "edit", "search", "mcp", "tool"] as const) {
      const thought = petTerminalFrame("working", 0, activity)[0]!.parts.map((p) => p.t).join("");
      assert.equal(stringWidth(thought), 8, `thought "${thought}" for ${activity}`);
    }
  });

  it("working frame shows the activity glyph as a top thought, stays 5 lines", () => {
    const frame = petTerminalFrame("working", 0, "search");
    assert.equal(frame.length, 5);
    const thought = frame[0]!.parts.map((p) => p.t).join("");
    assert.match(thought, /⌕/);
    // the tail keeps its energy pulse, not the activity glyph
    const tail = frame[frame.length - 1]!.parts.map((p) => p.t).join("");
    assert.doesNotMatch(tail, /⌕/);
    // generic "tool" keeps the baked-in sparkle line, no thought override
    const generic = petTerminalFrame("working", 0, "tool");
    const genTop = generic[0]!.parts.map((p) => p.t).join("");
    assert.doesNotMatch(genTop, /⌕/);
  });
});
