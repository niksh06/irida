import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  backgroundPauseState,
  isBackgroundPaused,
  setBackgroundPaused,
} from "../src/backgroundPause.js";
import { cronTick } from "../src/cronEngine.js";
import { writeExampleCronJobs } from "../src/cron_cmd.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "bgpause-"));
}

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.CSAGENT_PAUSE_BACKGROUND;
  if (value === undefined) delete process.env.CSAGENT_PAUSE_BACKGROUND;
  else process.env.CSAGENT_PAUSE_BACKGROUND = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CSAGENT_PAUSE_BACKGROUND;
    else process.env.CSAGENT_PAUSE_BACKGROUND = prev;
  }
}

test("setBackgroundPaused round-trips through the on-disk flag", () => {
  const dir = tmp();
  assert.equal(isBackgroundPaused(dir), false);

  const paused = setBackgroundPaused(dir, true, "negative balance");
  assert.equal(paused.paused, true);
  assert.equal(paused.source, "file");
  assert.equal(paused.reason, "negative balance");
  assert.equal(isBackgroundPaused(dir), true);

  setBackgroundPaused(dir, false);
  assert.equal(isBackgroundPaused(dir), false);
  assert.equal(backgroundPauseState(dir).source, "none");
});

test("CSAGENT_PAUSE_BACKGROUND env wins over a cleared file flag", () => {
  const dir = tmp();
  setBackgroundPaused(dir, false);
  withEnv("1", () => {
    const st = backgroundPauseState(dir);
    assert.equal(st.paused, true);
    assert.equal(st.source, "env");
  });
  // Once env is gone, the file flag (false) governs again.
  assert.equal(isBackgroundPaused(dir), false);
});

test("cron tick runs no jobs while background is paused", async () => {
  const dir = tmp();
  writeExampleCronJobs(dir, [{ id: "t1", cron: "* * * * *", prompt: "hi" }]);
  setBackgroundPaused(dir, true, "test");

  // cron "* * * * *" is due at any minute; without the gate this would execute.
  const result = await cronTick({ dir, at: new Date(2026, 0, 1, 9, 0, 0) });
  assert.deepEqual(result.ran, []);
  assert.deepEqual(result.skipped, ["t1"]);
  assert.deepEqual(result.errors, []);
});
