import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PET_HAPPY_MS, PET_RETRY_MS, PET_SLEEP_MS, levelForXp, resolvePetState } from "../src/petState.js";

describe("resolvePetState", () => {
  const now = 1_000_000;

  it("working when turn busy", () => {
    assert.equal(
      resolvePetState({
        turnBusy: true,
        toolRunning: false,
        lastEventAtMs: now,
        nowMs: now,
      }),
      "working"
    );
  });

  it("working when tool running", () => {
    assert.equal(
      resolvePetState({
        turnBusy: false,
        toolRunning: true,
        lastEventAtMs: now,
        nowMs: now,
      }),
      "working"
    );
  });

  it("sad after error", () => {
    assert.equal(
      resolvePetState({
        turnBusy: false,
        toolRunning: false,
        lastTurnError: true,
        lastEventAtMs: now,
        nowMs: now,
      }),
      "sad"
    );
  });

  it("happy briefly after ok turn", () => {
    assert.equal(
      resolvePetState({
        turnBusy: false,
        toolRunning: false,
        lastTurnOk: true,
        lastEventAtMs: now - 1000,
        nowMs: now,
        happyMs: PET_HAPPY_MS,
      }),
      "happy"
    );
  });

  it("idle after happy window", () => {
    assert.equal(
      resolvePetState({
        turnBusy: false,
        toolRunning: false,
        lastTurnOk: true,
        lastEventAtMs: now - PET_HAPPY_MS - 1,
        nowMs: now,
      }),
      "idle"
    );
  });

  it("sleep after long idle", () => {
    assert.equal(
      resolvePetState({
        turnBusy: false,
        toolRunning: false,
        lastEventAtMs: now - PET_SLEEP_MS - 1,
        nowMs: now,
      }),
      "sleep"
    );
  });

  it("retry wins over working within its window, expires after (I-148)", () => {
    const busy = { turnBusy: true, toolRunning: true, lastEventAtMs: now, nowMs: now };
    assert.equal(resolvePetState({ ...busy, retryAtMs: now - PET_RETRY_MS + 1000 }), "retry");
    assert.equal(resolvePetState({ ...busy, retryAtMs: now - PET_RETRY_MS - 1 }), "working");
  });

  it("worried on store degrade; sad beats it; it also keeps the pet awake (I-148)", () => {
    const calm = { turnBusy: false, toolRunning: false, nowMs: now };
    assert.equal(resolvePetState({ ...calm, storeDegraded: true, lastEventAtMs: now }), "worried");
    assert.equal(
      resolvePetState({ ...calm, storeDegraded: true, lastTurnError: true, lastEventAtMs: now }),
      "sad"
    );
    // degraded store blocks sleep — something is wrong, no napping
    assert.equal(
      resolvePetState({ ...calm, storeDegraded: true, lastEventAtMs: now - PET_SLEEP_MS - 1 }),
      "worried"
    );
  });
});

describe("levelForXp (I-148)", () => {
  it("steps at 10/25/50/100/200", () => {
    const expect: Array<[number, number]> = [
      [0, 1],
      [9, 1],
      [10, 2],
      [24, 2],
      [25, 3],
      [49, 3],
      [50, 4],
      [99, 4],
      [100, 5],
      [200, 6],
    ];
    for (const [xp, lv] of expect) assert.equal(levelForXp(xp), lv, `xp=${xp}`);
  });
});
