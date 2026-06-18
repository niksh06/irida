import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PET_HAPPY_MS, PET_SLEEP_MS, resolvePetState } from "../src/petState.js";

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
});
