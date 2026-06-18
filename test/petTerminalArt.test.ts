import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadPetTerminalArt, petTerminalArtFrame, resolvePetTerminalArt } from "../src/petTerminalArt.js";
import { resolvePetDir } from "../src/petAssets.js";

describe("petTerminalArt", () => {
  it("loads built idle art when terminal JSON present", () => {
    const petDir = resolvePetDir(process.cwd());
    assert.ok(petDir);
    const art = loadPetTerminalArt(petDir!, "idle", "light");
    if (!art) return;
    assert.ok(art.frames.length >= 1);
    const frame = petTerminalArtFrame(art, 0);
    assert.ok(frame.lines.length >= 1);
  });

  it("working art has multiple frames when GIF built", () => {
    const art = resolvePetTerminalArt(process.cwd(), "working", "light");
    if (!art) return;
    assert.ok(art.frames.length >= 2);
    const a = petTerminalArtFrame(art, 0);
    const b = petTerminalArtFrame(art, 1);
    const ta = a.lines.map((r) => r.map((s) => s.t).join("")).join("|");
    const tb = b.lines.map((r) => r.map((s) => s.t).join("")).join("|");
    assert.notEqual(ta, tb);
  });
});
