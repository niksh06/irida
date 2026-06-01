import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  parseCronExpression,
  nextCronRun,
  validateCronExpression,
  CronError,
} from "../src/cronSchedule.js";
import {
  loadCronJobs,
  isJobDue,
  loadCronState,
  CronJobsError,
} from "../src/cronJobs.js";
import { executeCronJob, cronTick } from "../src/cronEngine.js";
import { cmdCronList, cmdCronRun, writeExampleCronJobs } from "../src/cron_cmd.js";
import { gatherDoctorChecks } from "../src/doctorChecks.js";
import type { SdkLike } from "../src/host.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "cron-"));
}

async function withKey<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.CURSOR_API_KEY;
  if (value === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  }
}

function fakeSdk(): SdkLike {
  return {
    prompt: async () => ({ status: "finished", result: "cron ok", id: "r1", agentId: "a1" }),
  };
}

test("parseCronExpression matches minute and step", () => {
  const every5 = parseCronExpression("*/5 * * * *");
  assert.ok(every5.matches(new Date(2026, 4, 29, 10, 0, 0)));
  assert.ok(!every5.matches(new Date(2026, 4, 29, 10, 3, 0)));

  const daily9 = parseCronExpression("0 9 * * *");
  assert.ok(daily9.matches(new Date(2026, 4, 29, 9, 0, 0)));
  assert.ok(!daily9.matches(new Date(2026, 4, 29, 10, 0, 0)));
});

test("validateCronExpression rejects bad field count", () => {
  assert.throws(() => validateCronExpression("0 9 * *"), CronError);
});

test("nextCronRun finds upcoming slot", () => {
  const from = new Date(2026, 4, 29, 8, 30, 0);
  const next = nextCronRun("0 9 * * *", from);
  assert.ok(next);
  assert.equal(next!.getHours(), 9);
  assert.equal(next!.getMinutes(), 0);
});

test("loadCronJobs validates jobs file", () => {
  const dir = tmp();
  writeExampleCronJobs(dir, [
    { id: "nightly", cron: "0 9 * * *", prompt: "Summarize issues" },
  ]);
  const jobs = loadCronJobs(dir);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.id, "nightly");
});

test("loadCronJobs rejects duplicate ids", () => {
  const dir = tmp();
  writeExampleCronJobs(dir, [
    { id: "a", cron: "* * * * *", prompt: "one" },
    { id: "a", cron: "* * * * *", prompt: "two" },
  ]);
  assert.throws(() => loadCronJobs(dir), CronJobsError);
});

test("isJobDue respects state and enabled flag", () => {
  const job = { id: "j", cron: "0 9 * * *", prompt: "x" };
  const at = new Date(2026, 4, 29, 9, 0, 0);
  const state = loadCronState(tmp());
  assert.ok(isJobDue(job, at, state));
  state.lastRun.j = "2026-05-29 09:00";
  assert.ok(!isJobDue(job, at, state));
  assert.ok(!isJobDue({ ...job, enabled: false }, at, loadCronState(tmp())));
});

test("isJobDue matches scheduled minute within grace (launchd skew)", () => {
  const job = { id: "digest", cron: "0 */2 * * *", prompt: "x" };
  const state = loadCronState(tmp());
  const tick = new Date(2026, 5, 1, 2, 3, 0);
  assert.ok(isJobDue(job, tick, state));
  state.lastRun.digest = "2026-06-01 02:00";
  assert.ok(!isJobDue(job, tick, state));
});

test("isJobDue catches bi-hourly slot up to 10 min after launchd tick", () => {
  const job = { id: "digest", cron: "0 */2 * * *", prompt: "x" };
  const state = loadCronState(tmp());
  const tick = new Date(2026, 5, 1, 2, 7, 0);
  assert.ok(isJobDue(job, tick, state));
});

test("executeCronJob runs with mocked SDK", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    writeExampleCronJobs(dir, [{ id: "job1", cron: "0 9 * * *", prompt: "hello cron" }]);
    const result = await executeCronJob(loadCronJobs(dir)[0]!, { dir, sdk: fakeSdk() });
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
  });
});

test("executeCronJob blocks destructive without override", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const job = { id: "bad", cron: "* * * * *", prompt: "rm -rf /tmp/x" };
    const result = await executeCronJob(job, { dir, sdk: fakeSdk() });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 77);
  });
});

test("cronTick runs due jobs and updates state", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    writeExampleCronJobs(dir, [{ id: "tick1", cron: "* * * * *", prompt: "tick test" }]);
    const at = new Date(2026, 4, 29, 12, 0, 0);
    const result = await cronTick({ dir, sdk: fakeSdk(), at });
    assert.deepEqual(result.ran, ["tick1"]);
    assert.equal(result.errors.length, 0);
    const state = loadCronState(dir);
    assert.equal(state.lastRun.tick1, "2026-05-29 12:00");
    const again = await cronTick({ dir, sdk: fakeSdk(), at });
    assert.deepEqual(again.ran, []);
    assert.ok(again.skipped.includes("tick1"));
  });
});

test("cronTick continues after job failure", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    writeExampleCronJobs(dir, [
      { id: "fail", cron: "* * * * *", prompt: "x" },
      { id: "ok", cron: "* * * * *", prompt: "y" },
    ]);
    let n = 0;
    const sdk: SdkLike = {
      prompt: async () => {
        n++;
        if (n === 1) return { status: "error", id: "e1" };
        return { status: "finished", result: "ok", id: "e2", agentId: "a" };
      },
    };
    const at = new Date(2026, 4, 29, 15, 0, 0);
    const result = await cronTick({ dir, sdk, at });
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.id, "fail");
    assert.deepEqual(result.ran, ["ok"]);
  });
});

test("cmdCronList and cmdCronRun", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    writeExampleCronJobs(dir, [{ id: "manual", cron: "0 9 * * *", prompt: "run me" }]);
    assert.equal(cmdCronList({ dir }), 0);
    assert.equal(await cmdCronRun("manual", { dir, sdk: fakeSdk() }), 0);
    assert.equal(await cmdCronRun("missing", { dir }), 64);
  });
});

test("doctor validates cron jobs file when present", () => {
  const dir = tmp();
  writeExampleCronJobs(dir, [{ id: "x", cron: "not valid cron", prompt: "p" }]);
  const checks = gatherDoctorChecks(dir);
  const cron = checks.find((c) => c.name === "cron jobs");
  assert.ok(cron);
  assert.equal(cron!.ok, false);
});
