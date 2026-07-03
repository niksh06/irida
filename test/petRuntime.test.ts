import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";

import { resolvePetAssetPath, resolvePetDir } from "../src/petAssets.js";
import { PetRuntimeTracker, readPetStateSnapshot } from "../src/petRuntime.js";

describe("petAssets", () => {
  it("resolvePetDir finds manifest under repo root", () => {
    const dir = resolvePetDir(process.cwd());
    assert.ok(dir?.endsWith("deploy/assets/pet"));
  });

  it("resolvePetAssetPath prefers dist over source", () => {
    // Hermetic fixture — the repo's dist/ and *.png are gitignored, so a clean
    // checkout (CI) has neither; build a temp pet dir instead.
    const petDir = join(tmpdir(), `csagent-pet-assets-${Date.now()}`);
    mkdirSync(join(petDir, "dist", "light"), { recursive: true });
    mkdirSync(join(petDir, "source"), { recursive: true });
    writeFileSync(
      join(petDir, "manifest.json"),
      JSON.stringify({ version: 1, build: { outputLight: "dist/light" } }),
      "utf8"
    );

    // Only source present → falls back to source.
    writeFileSync(join(petDir, "source", "idle.png"), Buffer.from([0x89, 0x50]));
    const fromSource = resolvePetAssetPath(petDir, "idle", "light");
    assert.ok(fromSource);
    assert.match(fromSource!, /source\/idle\.png$/);

    // dist present → preferred over source.
    writeFileSync(join(petDir, "dist", "light", "idle.png"), Buffer.from([0x89, 0x50]));
    const fromDist = resolvePetAssetPath(petDir, "idle", "light");
    assert.ok(fromDist);
    assert.match(fromDist!, /dist\/light\/idle\.png$/);
  });
});

describe("PetRuntimeTracker", () => {
  it("writes snapshot on turn lifecycle", () => {
    const home = join(tmpdir(), `csagent-pet-${Date.now()}`);
    const petDir = join(home, "deploy", "assets", "pet");
    mkdirSync(join(petDir, "dist", "light"), { recursive: true });
    mkdirSync(join(home, ".agent"), { recursive: true });
    writeFileSync(
      join(petDir, "manifest.json"),
      JSON.stringify({ version: 1, build: { outputLight: "dist/light" } }),
      "utf8"
    );
    writeFileSync(join(petDir, "dist", "light", "idle.png"), Buffer.from([0x89, 0x50]), "utf8");
    writeFileSync(join(petDir, "dist", "light", "happy.png"), Buffer.from([0x89, 0x50]), "utf8");

    const prevRoot = process.env.CSAGENT_ROOT;
    process.env.CSAGENT_ROOT = home;
    try {
      const tracker = new PetRuntimeTracker({ dir: home });
      tracker.beginTurn();
      tracker.endTurn(true);
      const snap = readPetStateSnapshot(home);
      assert.ok(snap);
      assert.equal(snap!.state, "happy");
      assert.ok(snap!.assetPath);
    } finally {
      if (prevRoot === undefined) delete process.env.CSAGENT_ROOT;
      else process.env.CSAGENT_ROOT = prevRoot;
    }
  });

  // I-148: XP banks on ok turns (+1, +3 bonus each 10-streak), resets streak on
  // error, and survives tracker restarts via the snapshot (additive v1 field).
  it("earns XP with streak bonus and re-seeds from the snapshot (I-148)", () => {
    const home = join(tmpdir(), `wisp-xp-${Date.now()}`);
    mkdirSync(join(home, ".agent"), { recursive: true });
    const prevRoot = process.env.CSAGENT_ROOT;
    process.env.CSAGENT_ROOT = home;
    try {
      const tracker = new PetRuntimeTracker({ dir: home });
      for (let i = 0; i < 10; i++) tracker.endTurn(true);
      let snap = readPetStateSnapshot(home);
      assert.equal(snap!.xp, 13); // 10×1 + streak bonus at #10
      assert.equal(snap!.streakOk, 10);

      tracker.endTurn(false); // error: streak resets, xp keeps
      snap = readPetStateSnapshot(home);
      assert.equal(snap!.xp, 13);
      assert.equal(snap!.streakOk, 0);

      // A fresh tracker in the same dir continues, not restarts, the progress.
      const revived = new PetRuntimeTracker({ dir: home });
      revived.endTurn(true);
      snap = readPetStateSnapshot(home);
      assert.equal(snap!.xp, 14);
      assert.equal(snap!.streakOk, 1);
    } finally {
      if (prevRoot === undefined) delete process.env.CSAGENT_ROOT;
      else process.env.CSAGENT_ROOT = prevRoot;
    }
  });

  // I-146: the Wisp overlay renders glyph frames from the snapshot alone, so
  // the tracker must run with no PNG pipeline at all (assetPath just stays
  // null on machines without built assets — not asserted, machine-dependent).
  it("tracks state and activity with no pet assets (I-146)", () => {
    const home = join(tmpdir(), `wisp-noassets-${Date.now()}`);
    mkdirSync(join(home, ".agent"), { recursive: true });
    const prevRoot = process.env.CSAGENT_ROOT;
    process.env.CSAGENT_ROOT = home; // no manifest under this root
    try {
      const tracker = new PetRuntimeTracker({ dir: home });
      tracker.beginTurn();
      tracker.onActivity({
        label: "grep",
        kind: "tool",
        toolName: "grep",
        phase: "call",
        status: "running",
      });
      let snap = readPetStateSnapshot(home);
      assert.ok(snap);
      assert.equal(snap!.state, "working");
      assert.equal(snap!.activity, "search");
      tracker.endTurn(false);
      snap = readPetStateSnapshot(home);
      assert.equal(snap!.state, "sad");
      tracker.endTurn(true);
      snap = readPetStateSnapshot(home);
      assert.equal(snap!.state, "happy");
    } finally {
      if (prevRoot === undefined) delete process.env.CSAGENT_ROOT;
      else process.env.CSAGENT_ROOT = prevRoot;
    }
  });
});
