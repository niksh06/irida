import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CRON_JOBS_BACKUP_PREFIX,
  CronJobsError,
  loadCronJobs,
  saveCronJobs,
} from "../src/cronJobs.js";
import { writeExampleCronJobs } from "../src/cron_cmd.js";
import { gatherGatewayStatus } from "../src/gatewayStatus.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "cron-guard-"));
}

test("saveCronJobs rejects invalid jobs and leaves file unchanged", () => {
  const dir = tmp();
  saveCronJobs(dir, [{ id: "good", cron: "0 9 * * *", prompt: "ok" }]);
  const before = readFileSync(join(dir, ".agent", "cron.jobs.json"), "utf8");
  assert.throws(
    () => saveCronJobs(dir, [{ id: "bad", cron: "not valid cron", prompt: "p" }]),
    CronJobsError
  );
  assert.equal(readFileSync(join(dir, ".agent", "cron.jobs.json"), "utf8"), before);
});

test("saveCronJobs creates timestamped backup on successful overwrite", () => {
  const dir = tmp();
  saveCronJobs(dir, [{ id: "a", cron: "0 9 * * *", prompt: "first" }]);
  saveCronJobs(dir, [{ id: "b", cron: "0 10 * * *", prompt: "second" }]);
  const agentDir = join(dir, ".agent");
  const backups = readdirSync(agentDir).filter((f) => f.startsWith(CRON_JOBS_BACKUP_PREFIX));
  assert.equal(backups.length, 1);
  const jobs = loadCronJobs(dir);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.id, "b");
});

test("writeExampleCronJobs rejects invalid fixture (no bypass write)", () => {
  const dir = tmp();
  assert.throws(
    () => writeExampleCronJobs(dir, [{ id: "x", cron: "not valid cron", prompt: "p" }]),
    CronJobsError
  );
  assert.equal(existsSync(join(dir, ".agent", "cron.jobs.json")), false);
});

test("gatherGatewayStatus FAIL when cron jobs invalid", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, ".agent", "cron.jobs.json"),
    JSON.stringify({ version: 1, jobs: [{ id: "x", cron: "not valid cron", prompt: "p" }] }, null, 2) + "\n",
    "utf8"
  );
  const row = gatherGatewayStatus(dir).find((r) => r.name === "cron jobs");
  assert.ok(row);
  assert.equal(row!.ok, false);
  assert.match(row!.detail, /not valid cron|invalid/i);
});

test("refuses cron jobs write under CSAGENT_HOME/.agent during npm test", () => {
  const home = tmp();
  const agent = join(home, ".agent");
  mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, "cron.jobs.json"), '{"version":1,"jobs":[]}\n', "utf8");
  const prevHome = process.env.CSAGENT_HOME;
  const prevAllow = process.env.CSAGENT_ALLOW_PROD_STATE_WRITE;
  process.env.CSAGENT_HOME = home;
  delete process.env.CSAGENT_ALLOW_PROD_STATE_WRITE;
  try {
    assert.throws(
      () => saveCronJobs(home, [{ id: "x", cron: "0 9 * * *", prompt: "p" }]),
      (e: unknown) => e instanceof CronJobsError && /refusing to write/.test(e.message)
    );
  } finally {
    if (prevHome === undefined) delete process.env.CSAGENT_HOME;
    else process.env.CSAGENT_HOME = prevHome;
    if (prevAllow === undefined) delete process.env.CSAGENT_ALLOW_PROD_STATE_WRITE;
    else process.env.CSAGENT_ALLOW_PROD_STATE_WRITE = prevAllow;
    rmSync(home, { recursive: true, force: true });
  }
});
