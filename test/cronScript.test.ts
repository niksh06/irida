import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  evaluateGateOutput,
  runCronGate,
  runCronScript,
  resolveCronScriptPath,
  type CronScriptRun,
} from "../src/cronScript.js";
import { executeCronJob, cronTick } from "../src/cronEngine.js";
import { findDueCronMinute, loadCronJobs, loadCronState } from "../src/cronJobs.js";
import { writeExampleCronJobs } from "../src/cron_cmd.js";
import type { SdkLike } from "../src/host.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "cronscript-"));
}

async function withKey<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = "k";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
}

function fakeSdk(): SdkLike {
  return { prompt: async () => ({ status: "finished", result: "ok", id: "r", agentId: "a" }) };
}

function run(over: Partial<CronScriptRun>): CronScriptRun {
  return { exitCode: 0, stdout: "", stderr: "", timedOut: false, ...over };
}

test("evaluateGateOutput: wakeAgent false skips, everything else wakes (fail-open)", () => {
  assert.equal(evaluateGateOutput(run({ stdout: '{"wakeAgent": false, "reason": "no new posts"}' })).wake, false);
  assert.equal(evaluateGateOutput(run({ stdout: 'log line\n{"wakeAgent": false}' })).wake, false);
  assert.equal(evaluateGateOutput(run({ stdout: '{"wakeAgent": true}' })).wake, true);
  assert.equal(evaluateGateOutput(run({ stdout: "plain text" })).wake, true);
  assert.equal(evaluateGateOutput(run({ exitCode: 3 })).wake, true);
  assert.equal(evaluateGateOutput(run({ timedOut: true })).wake, true);
  assert.equal(evaluateGateOutput(run({ error: "ENOENT" })).wake, true);
});

test("runCronScript executes via bash without +x and captures stdout", () => {
  const dir = tmp();
  const script = join(dir, "probe.sh");
  writeFileSync(script, 'echo "hello from script"\n', "utf8"); // no chmod +x
  const out = runCronScript(script);
  assert.equal(out.exitCode, 0);
  assert.equal(out.stdout, "hello from script");
});

test("runCronGate: missing gate fails open, real gate skips", () => {
  const dir = tmp();
  writeFileSync(resolve(dir, "agent.config.json"), JSON.stringify({ stateDir: ".agent", cwd: dir }), "utf8");
  const missing = runCronGate({ id: "j", cron: "* * * * *", gateScript: "nope.sh" }, dir);
  assert.equal(missing.wake, true);

  const gate = join(dir, "gate.sh");
  writeFileSync(gate, 'echo \'{"wakeAgent": false, "reason": "quiet day"}\'\n', "utf8");
  const skip = runCronGate({ id: "j", cron: "* * * * *", gateScript: "gate.sh" }, dir);
  assert.equal(skip.wake, false);
  assert.equal(skip.reason, "quiet day");
});

test("resolveCronScriptPath prefers job cwd, falls back to config dir", () => {
  const cfgDir = tmp();
  const jobCwd = tmp();
  writeFileSync(join(jobCwd, "s.sh"), "echo hi\n", "utf8");
  const job = { id: "j", cron: "* * * * *", cwd: jobCwd };
  assert.equal(resolveCronScriptPath(job, cfgDir, "s.sh"), join(jobCwd, "s.sh"));
  writeFileSync(join(cfgDir, "only-cfg.sh"), "echo hi\n", "utf8");
  assert.equal(resolveCronScriptPath({ id: "j", cron: "* * * * *" }, cfgDir, "only-cfg.sh"), join(cfgDir, "only-cfg.sh"));
});

test("script job: stdout → notify text, empty stdout → silent", async () => {
  await withKey(async () => {
    const dir = tmp();
    const noisy = join(dir, "noisy.sh");
    writeFileSync(noisy, 'echo "problem: outbox backlog"\n', "utf8");
    const quiet = join(dir, "quiet.sh");
    writeFileSync(quiet, "exit 0\n", "utf8");
    writeExampleCronJobs(dir, [
      { id: "noisy", cron: "* * * * *", script: "noisy.sh" },
      { id: "quiet", cron: "* * * * *", script: "quiet.sh" },
    ]);
    const jobs = loadCronJobs(dir);

    const noisyRes = await executeCronJob(jobs[0]!, { dir });
    assert.equal(noisyRes.ok, true);
    assert.match(noisyRes.output ?? "", /outbox backlog/);
    assert.ok(!noisyRes.silent);

    const quietRes = await executeCronJob(jobs[1]!, { dir });
    assert.equal(quietRes.ok, true);
    assert.equal(quietRes.silent, true);
  });
});

test("script job failure surfaces stderr", async () => {
  await withKey(async () => {
    const dir = tmp();
    const bad = join(dir, "bad.sh");
    writeFileSync(bad, 'echo "boom details" >&2\nexit 3\n', "utf8");
    writeExampleCronJobs(dir, [{ id: "bad", cron: "* * * * *", script: "bad.sh" }]);
    const res = await executeCronJob(loadCronJobs(dir)[0]!, { dir });
    assert.equal(res.ok, false);
    assert.match(res.message, /exit 3/);
    assert.match(res.message, /boom details/);
  });
});

test("cronTick: gateScript wakeAgent:false skips SDK and claims the slot", async () => {
  await withKey(async () => {
    const dir = tmp();
    const gate = join(dir, "gate.sh");
    writeFileSync(gate, 'echo \'{"wakeAgent": false, "reason": "nothing new"}\'\n', "utf8");
    writeExampleCronJobs(dir, [
      { id: "gated", cron: "* * * * *", prompt: "expensive digest", gateScript: "gate.sh" },
    ]);
    let sdkCalled = 0;
    const sdk: SdkLike = {
      prompt: async () => {
        sdkCalled++;
        return { status: "finished", result: "x", id: "r", agentId: "a" };
      },
    };
    const at = new Date(2026, 5, 12, 10, 0, 0);
    const result = await cronTick({ dir, sdk, at });
    assert.equal(sdkCalled, 0);
    assert.ok(result.skipped.includes("gated"));
    // Slot claimed: same tick again → still skipped, no retry storm.
    const state = loadCronState(dir);
    assert.equal(state.lastRun.gated, "2026-06-12 10:00");
    assert.match(state.lastResult?.gated?.message ?? "", /gated: nothing new/);
  });
});

test("cronTick: gate wakeAgent:true runs the job", async () => {
  await withKey(async () => {
    const dir = tmp();
    const gate = join(dir, "gate.sh");
    writeFileSync(gate, 'echo \'{"wakeAgent": true}\'\n', "utf8");
    writeExampleCronJobs(dir, [
      { id: "awake", cron: "* * * * *", prompt: "run me", gateScript: "gate.sh" },
    ]);
    let sdkCalled = 0;
    const sdk: SdkLike = {
      prompt: async () => {
        sdkCalled++;
        return { status: "finished", result: "x", id: "r", agentId: "a" };
      },
    };
    const result = await cronTick({ dir, sdk, at: new Date(2026, 5, 12, 11, 0, 0) });
    assert.equal(sdkCalled, 1);
    assert.deepEqual(result.ran, ["awake"]);
  });
});

test("catchUp skip caps lookback at the standard window", () => {
  const state = { version: 1, lastRun: {} };
  const wake = new Date(2026, 5, 12, 6, 0, 0); // daily slot 23:59 missed by hours
  const onceJob = { id: "d", cron: "59 23 * * *", prompt: "x", graceMinutes: 480 };
  assert.ok(findDueCronMinute(onceJob, wake, state)); // once (default) catches up
  const skipJob = { ...onceJob, catchUp: "skip" as const };
  assert.equal(findDueCronMinute(skipJob, wake, state), null); // skip drops stale slot
});
