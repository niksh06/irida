import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  parseCronExpression,
  nextCronRun,
  validateCronExpression,
  CronError,
} from "../src/cronSchedule.js";
import {
  loadCronJobs,
  isJobDue,
  findDueCronMinute,
  loadCronState,
  CronJobsError,
} from "../src/cronJobs.js";
import { executeCronJob, cronTick } from "../src/cronEngine.js";
import { cmdCronList, cmdCronRun, writeExampleCronJobs } from "../src/cron_cmd.js";
import { gatherDoctorChecks } from "../src/doctorChecks.js";
import { createMemoryStore } from "../src/memoryStore.js";
import { createStore } from "../src/store.js";
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

test("step anchors at field min for dom/month (vixie semantics)", () => {
  // */5 in dom == 1,6,11,… (anchored at 1), not 5,10,15,…
  const domStep = parseCronExpression("0 0 */5 * *");
  assert.ok(domStep.matches(new Date(2026, 4, 1, 0, 0, 0)));
  assert.ok(domStep.matches(new Date(2026, 4, 6, 0, 0, 0)));
  assert.ok(!domStep.matches(new Date(2026, 4, 5, 0, 0, 0)));
  // minute field unchanged: */15 == 0,15,30,45
  const minStep = parseCronExpression("*/15 * * * *");
  assert.ok(minStep.matches(new Date(2026, 4, 1, 10, 30, 0)));
  assert.ok(!minStep.matches(new Date(2026, 4, 1, 10, 20, 0)));
});

test("restricted dom OR dow matches either (vixie semantics)", () => {
  // 9:00 on the 15th OR on Mondays
  const cron = parseCronExpression("0 9 15 * 1");
  const mon = new Date(2026, 5, 8, 9, 0, 0); // Mon Jun 8 2026, not the 15th
  const fifteenth = new Date(2026, 5, 15, 9, 0, 0); // Mon — also dom match
  const tueSixteenth = new Date(2026, 5, 16, 9, 0, 0); // Tue 16th — neither
  assert.equal(mon.getDay(), 1);
  assert.ok(cron.matches(mon));
  assert.ok(cron.matches(fifteenth));
  assert.ok(!cron.matches(tueSixteenth));
  // dom restricted, dow wildcard → dom must match
  const domOnly = parseCronExpression("0 9 15 * *");
  assert.ok(!domOnly.matches(mon));
  assert.ok(domOnly.matches(fifteenth));
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

test("job-level graceMinutes extends missed-slot lookback (daily after sleep)", () => {
  const job = { id: "daily", cron: "59 23 * * *", prompt: "x", graceMinutes: 480 };
  const state = loadCronState(tmp());
  state.lastRun.daily = "2026-05-31 23:59";
  // Machine slept through 23:59; first tick at 00:40 next day.
  const wake = new Date(2026, 5, 2, 0, 40, 0);
  assert.ok(isJobDue(job, wake, state));
  // Default 10-min grace would have missed it.
  assert.ok(!isJobDue({ ...job, graceMinutes: undefined }, wake, state));
});

test("loadCronJobs parses graceMinutes", () => {
  const dir = tmp();
  writeExampleCronJobs(dir, [
    { id: "daily", cron: "59 23 * * *", prompt: "x", graceMinutes: 480 },
  ]);
  assert.equal(loadCronJobs(dir)[0]!.graceMinutes, 480);
});

test("missed older slot within grace is caught, not skipped", () => {
  const job = { id: "five", cron: "*/5 * * * *", prompt: "x" };
  const state = loadCronState(tmp());
  state.lastRun.five = "2026-06-01 09:55";
  // Tick at 10:07 — both 10:00 and 10:05 elapsed; oldest unran slot wins.
  const due = findDueCronMinute(job, new Date(2026, 5, 1, 10, 7, 0), state);
  assert.ok(due);
  assert.equal(due!.getMinutes(), 0);
});

test("loadCronJobs accepts promptFile without inline prompt", () => {
  const dir = tmp();
  const prompts = join(dir, "prompts");
  mkdirSync(prompts, { recursive: true });
  writeFileSync(join(prompts, "job.txt"), "from file");
  writeExampleCronJobs(dir, [{ id: "filejob", cron: "0 9 * * *", promptFile: "prompts/job.txt" }]);
  const jobs = loadCronJobs(dir);
  assert.equal(jobs[0]!.promptFile, "prompts/job.txt");
  assert.equal(jobs[0]!.prompt, undefined);
});

test("loadCronJobs accepts builtin memory-audit without prompt", () => {
  const dir = tmp();
  writeExampleCronJobs(dir, [{ id: "audit", cron: "0 5 * * 0", builtin: "memory-audit" }]);
  const jobs = loadCronJobs(dir);
  assert.equal(jobs[0]!.builtin, "memory-audit");
});

test("executeCronJob runs memory-audit builtin", async () => {
  await withKey("crsr_" + "x".repeat(24), async () => {
    const dir = tmp();
    const store = createMemoryStore(dir, ".agent");
    await store.upsertNote({ name: "ops", body: "# Ops\n" + "x".repeat(100) });
    await store.close();
    writeExampleCronJobs(dir, [{ id: "audit", cron: "0 5 * * 0", builtin: "memory-audit" }]);
    const result = await executeCronJob(loadCronJobs(dir)[0]!, { dir, sdk: fakeSdk() });
    assert.equal(result.ok, true);
    assert.match(result.output ?? "", /memory audit/);
  });
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

test("executeCronJob loads promptFile", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const prompts = join(dir, "prompts");
    mkdirSync(prompts, { recursive: true });
    writeFileSync(join(prompts, "digest.txt"), "digest from file");
    writeExampleCronJobs(dir, [{ id: "filejob", cron: "0 9 * * *", promptFile: "prompts/digest.txt" }]);
    const result = await executeCronJob(loadCronJobs(dir)[0]!, { dir, sdk: fakeSdk() });
    assert.equal(result.ok, true);
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

test("cronTick skips everything when another tick holds the lock", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    writeExampleCronJobs(dir, [{ id: "tick1", cron: "* * * * *", prompt: "tick test" }]);
    const lockPath = resolve(dir, ".agent", "cron.tick.lock");
    mkdirSync(resolve(dir, ".agent"), { recursive: true });
    writeFileSync(lockPath, `${process.pid} ${new Date().toISOString()}\n`, "utf8");
    const at = new Date(2026, 4, 29, 12, 0, 0);
    const result = await cronTick({ dir, sdk: fakeSdk(), at });
    assert.deepEqual(result.ran, []);
    assert.ok(result.skipped.includes("tick1"));
    // Lock released by owner → next tick proceeds.
    rmSync(lockPath, { force: true });
    const again = await cronTick({ dir, sdk: fakeSdk(), at });
    assert.deepEqual(again.ran, ["tick1"]);
  });
});

test("cronTick breaks a stale lock (TTL exceeded)", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    writeExampleCronJobs(dir, [{ id: "tick1", cron: "* * * * *", prompt: "tick test" }]);
    const lockPath = resolve(dir, ".agent", "cron.tick.lock");
    mkdirSync(resolve(dir, ".agent"), { recursive: true });
    writeFileSync(lockPath, "999999 stale\n", "utf8");
    const old = Date.now() - 2 * 60 * 60 * 1000;
    utimesSync(lockPath, old / 1000, old / 1000);
    const at = new Date(2026, 4, 29, 12, 0, 0);
    const result = await cronTick({ dir, sdk: fakeSdk(), at });
    assert.deepEqual(result.ran, ["tick1"]);
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

test("builtin session-export writes markdown for recent sessions", async () => {
  await withKey("k", async () => {
    const dir = tmp();
    const store = createStore(dir, ".agent");
    await store.upsertSession({
      id: "sess_exp1",
      title: "export me",
      cwd: dir,
      runtime: "local",
      sdk_agent_id: null,
      last_status: "finished",
    });
    await store.recordRun({
      id: "run_exp1",
      session_id: "sess_exp1",
      sdk_agent_id: null,
      sdk_run_id: null,
      prompt_preview: "hello world",
      result_preview: "assistant answer",
      status: "finished",
      error_kind: null,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      cwd: dir,
      runtime: "local",
      model: "m",
    });
    await store.close();

    const job = { id: "exp", cron: "0 23 * * *", builtin: "session-export" as const };
    const result = await executeCronJob(job, { dir });
    assert.equal(result.ok, true);
    assert.match(result.message, /1 session/);
    const day = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const outDir = resolve(
      dir,
      "Reports",
      "sessions",
      `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
    );
    const body = readFileSync(resolve(outDir, "sess_exp1.md"), "utf8");
    assert.match(body, /hello world/);
    assert.match(body, /assistant answer/);
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
