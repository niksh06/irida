import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  addUserCronJob,
  approveCronSchedule,
  normalizeUserJobId,
  parseScheduleAddArgs,
  proposeUserCronJob,
  removeUserCronJob,
} from "../src/cronScheduleOps.js";
import { loadCronJobs } from "../src/cronJobs.js";

function setupDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "cron-sched-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ stateDir: ".agent", cwd: dir }),
    "utf8"
  );
  writeFileSync(join(dir, ".agent", "cron.jobs.json"), JSON.stringify({ version: 1, jobs: [] }), "utf8");
  return dir;
}

test("normalizeUserJobId adds user- prefix", () => {
  assert.equal(normalizeUserJobId("weekly-inbox"), "user-weekly-inbox");
  assert.equal(normalizeUserJobId("user-already"), "user-already");
});

test("parseScheduleAddArgs extracts cron id prompt", () => {
  const d = parseScheduleAddArgs("add 0 9 * * 1 weekly-inbox Summarize my tasks");
  assert.ok(d);
  assert.equal(d!.cron, "0 9 * * 1");
  assert.equal(d!.id, "weekly-inbox");
  assert.match(d!.prompt, /Summarize/);
});

test("propose and approve adds user cron job", () => {
  const dir = setupDir();
  const peer = { chatId: "12345", adapter: "telegram" };
  const prop = proposeUserCronJob(
    dir,
    { id: "test-job", cron: "0 10 * * *", prompt: "Say hello from cron" },
    peer
  );
  assert.equal(prop.ok, true);
  assert.ok(prop.code);
  const bad = approveCronSchedule(dir, prop.code!, "99999");
  assert.equal(bad.ok, false);
  const ok = approveCronSchedule(dir, prop.code!, peer.chatId);
  assert.equal(ok.ok, true);
  const jobs = loadCronJobs(dir);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.id, "user-test-job");
  assert.equal(jobs[0]!.notify?.chatId, "12345");
});

test("addUserCronJob and removeUserCronJob", () => {
  const dir = setupDir();
  const add = addUserCronJob(
    dir,
    { id: "x", cron: "30 8 * * *", prompt: "Daily ping" },
    { chatId: "1", telegram: true }
  );
  assert.equal(add.ok, true);
  const rm = removeUserCronJob(dir, "user-x");
  assert.equal(rm.ok, true);
  assert.equal(loadCronJobs(dir).length, 0);
});

test("cannot remove protected system job", () => {
  const dir = setupDir();
  writeFileSync(
    join(dir, ".agent", "cron.jobs.json"),
    JSON.stringify({
      version: 1,
      jobs: [{ id: "tparser-daily-digest", cron: "59 23 * * *", prompt: "x" }],
    }),
    "utf8"
  );
  const rm = removeUserCronJob(dir, "tparser-daily-digest");
  assert.equal(rm.ok, false);
});
