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

import { PET_STATES } from "../src/petState.js";

/** Iterate every frame of every state (self-maintaining as states/animations grow). */
const eachFrame = (fn: (state: (typeof PET_STATES)[number], tick: number) => void) => {
  for (const state of PET_STATES) for (let tick = 0; tick < PET_WISP_FRAMES[state].length; tick++) fn(state, tick);
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

  it("retry hiccup interrupts working, then working resumes (I-148)", () => {
    const base = {
      busy: true,
      activityLog: [{ phase: "call" as const, status: "running" as const }],
      lastTurnOk: false,
      lastTurnError: false,
      lastEventAtMs: now,
    };
    assert.equal(deriveTuiPetState({ ...base, retryAtMs: now - 1000, nowMs: now }), "retry");
    assert.equal(deriveTuiPetState({ ...base, retryAtMs: now - 7000, nowMs: now }), "working");
  });

  it("worried while store degraded; a clean turn (flag cleared) goes happy (I-148)", () => {
    const base = { busy: false, activityLog: [], lastTurnOk: false, lastTurnError: false, lastEventAtMs: now, nowMs: now };
    assert.equal(deriveTuiPetState({ ...base, storeDegraded: true }), "worried");
    // sad wins over worried — an actual error is the stronger signal
    assert.equal(deriveTuiPetState({ ...base, lastTurnError: true, storeDegraded: true }), "sad");
    assert.equal(deriveTuiPetState({ ...base, lastTurnOk: true, storeDegraded: false }), "happy");
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

  it("working spins, then locks a focused ◉ at the energy peak (parity with idle's depth)", () => {
    const frames = PET_WISP_FRAMES.working;
    const eyes = frames.map((f) => f[2]!.parts.map((p) => p.t).join(""));
    const tails = frames.map((f) => f[f.length - 1]!.parts.map((p) => p.t).join(""));
    // the spin uses all four quadrants...
    for (const q of ["◐", "◓", "◑", "◒"]) {
      assert.ok(eyes.some((e) => e.includes(q)), `working should rotate through ${q}`);
    }
    // ...and exactly one frame is the focused lock ◉, which sits on the energy peak ≋≋
    const focus = eyes.findIndex((e) => e.includes("◉"));
    assert.ok(focus >= 0, "working should have a focus-lock ◉ beat");
    assert.match(tails[focus]!, /≋≋/, "the focus beat should land on the energy peak");
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

  it("level decor thickens the aura but never breaks the 8-col/5-row invariants (I-148)", () => {
    eachFrame((state, tick) => {
      for (const level of [1, 3, 5]) {
        const lines = petTerminalFrame(state, tick, undefined, level);
        assert.equal(lines.length, 5);
        for (const line of lines) {
          assert.equal(stringWidth(line.parts.map((p) => p.t).join("")), 8, `${state}@${tick} lv${level}`);
        }
      }
    });
    // The visible change is real: idle's soft tail diamond hardens at lv.3.
    const soft = petTerminalFrame("idle", 0, undefined, 1).map((l) => l.parts.map((p) => p.t).join("")).join("\n");
    const hard = petTerminalFrame("idle", 0, undefined, 3).map((l) => l.parts.map((p) => p.t).join("")).join("\n");
    assert.ok(soft.includes("◇") && !soft.includes("◆"));
    assert.ok(hard.includes("◆") && !hard.includes("◇"));
  });

  it("labels: retry/worried get words; the lv badge appears from lv.2 (I-148)", () => {
    assert.equal(petTerminalLabel("retry"), "wisp · hiccup!");
    assert.equal(petTerminalLabel("worried"), "wisp · uneasy");
    assert.equal(petTerminalLabel("idle", undefined, 1), "wisp · watching");
    assert.equal(petTerminalLabel("idle", undefined, 3), "wisp · watching · lv.3");
    assert.equal(petTerminalLabel("working", "search", 2), "wisp · searching… · lv.2");
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
