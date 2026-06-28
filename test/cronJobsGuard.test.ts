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
  CRON_BUILTIN_HANDLERS,
  CronJobsError,
  loadCronJobs,
  saveCronJobs,
} from "../src/cronJobs.js";
import { writeExampleCronJobs } from "../src/cron_cmd.js";
import { gatherGatewayStatus } from "../src/gatewayStatus.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "cron-guard-"));
}

test("every CRON_BUILTIN_HANDLERS entry round-trips save→load (I-128 enum drift guard)", () => {
  // The cron read-path (loadCronJobs, used by the cron_list MCP tool) validates
  // each job's builtin against CRON_BUILTIN_HANDLERS. I-128: a stale enum (built
  // dist behind src) dropped the 5 newer builtins → loadCronJobs threw on them →
  // the whole listing failed even though the jobs ran. Lock the enum: every entry
  // must load without throwing, so dropping one breaks the test, not prod.
  const dir = tmp();
  const jobs = CRON_BUILTIN_HANDLERS.map((b) => ({ id: `b-${b}`, cron: "0 0 * * *", builtin: b }));
  saveCronJobs(dir, jobs); // validates on write
  const loaded = loadCronJobs(dir); // validates on read — the cron_list path
  assert.equal(loaded.length, CRON_BUILTIN_HANDLERS.length);
  assert.deepEqual(
    new Set(loaded.map((j) => j.builtin)),
    new Set(CRON_BUILTIN_HANDLERS)
  );
});

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

test("refuses cron jobs write under the live home/.agent during a test run", () => {
  const home = tmp();
  const agent = join(home, ".agent");
  mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, "cron.jobs.json"), '{"version":1,"jobs":[]}\n', "utf8");
  // Make iridaHome() resolve to our fake home deterministically (IRIDA_HOME wins
  // over CSAGENT_HOME), and ensure no ALLOW override is set in either prefix.
  const prev = {
    IRIDA_HOME: process.env.IRIDA_HOME,
    CSAGENT_HOME: process.env.CSAGENT_HOME,
    IRIDA_ALLOW: process.env.IRIDA_ALLOW_PROD_STATE_WRITE,
    CSAGENT_ALLOW: process.env.CSAGENT_ALLOW_PROD_STATE_WRITE,
  };
  process.env.IRIDA_HOME = home;
  process.env.CSAGENT_HOME = home;
  delete process.env.IRIDA_ALLOW_PROD_STATE_WRITE;
  delete process.env.CSAGENT_ALLOW_PROD_STATE_WRITE;
  try {
    assert.throws(
      () => saveCronJobs(home, [{ id: "x", cron: "0 9 * * *", prompt: "p" }]),
      (e: unknown) => e instanceof CronJobsError && /refusing to write/.test(e.message)
    );
  } finally {
    for (const [k, v] of Object.entries({
      IRIDA_HOME: prev.IRIDA_HOME,
      CSAGENT_HOME: prev.CSAGENT_HOME,
      IRIDA_ALLOW_PROD_STATE_WRITE: prev.IRIDA_ALLOW,
      CSAGENT_ALLOW_PROD_STATE_WRITE: prev.CSAGENT_ALLOW,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
