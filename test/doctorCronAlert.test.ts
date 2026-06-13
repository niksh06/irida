import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  cmdDoctorMorningAlert,
  formatDoctorCronMorningAlert,
  gatherCronHealthCheck,
} from "../src/doctorCronAlert.js";
import { writeExampleCronJobs } from "../src/cron_cmd.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "doc-cron-alert-"));
}

test("gatherCronHealthCheck fails when cron.jobs.json missing", () => {
  const dir = tmp();
  const check = gatherCronHealthCheck(dir);
  assert.equal(check.ok, false);
  assert.match(check.detail, /missing/);
});

test("gatherCronHealthCheck fails on invalid cron expression", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, ".agent", "cron.jobs.json"),
    JSON.stringify({ version: 1, jobs: [{ id: "x", cron: "not valid cron", prompt: "p" }] }, null, 2) +
      "\n",
    "utf8"
  );
  const check = gatherCronHealthCheck(dir);
  assert.equal(check.ok, false);
  assert.match(check.detail, /cron/i);
});

test("gatherCronHealthCheck passes on valid jobs file", () => {
  const dir = tmp();
  writeExampleCronJobs(dir, [{ id: "ok", cron: "0 9 * * *", prompt: "hi" }]);
  const check = gatherCronHealthCheck(dir);
  assert.equal(check.ok, true);
});

test("formatDoctorCronMorningAlert includes doctor detail and fix", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, ".agent", "cron.jobs.json"),
    JSON.stringify({ version: 1, jobs: [{ id: "x", cron: "bad", prompt: "p" }] }, null, 2) + "\n",
    "utf8"
  );
  const check = gatherCronHealthCheck(dir);
  const text = formatDoctorCronMorningAlert(check, dir);
  assert.match(text, /morning cron health FAIL/);
  assert.match(text, /doctor:/);
  if (check.fix) assert.match(text, /fix:/);
});

test("cmdDoctorMorningAlert returns 0 when cron health OK", async () => {
  const dir = tmp();
  writeExampleCronJobs(dir, [{ id: "ok", cron: "0 9 * * *", prompt: "hi" }]);
  assert.equal(await cmdDoctorMorningAlert(dir), 0);
});

test("cmdDoctorMorningAlert returns 1 when invalid and no telegram target", async () => {
  const dir = tmp();
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, ".agent", "cron.jobs.json"),
    JSON.stringify({ version: 1, jobs: [{ id: "x", cron: "not valid cron", prompt: "p" }] }, null, 2) +
      "\n",
    "utf8"
  );
  assert.equal(await cmdDoctorMorningAlert(dir), 1);
});
