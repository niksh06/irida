import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cronCadenceHours, evaluateRecurringStaleness } from "../src/selfMonitor.js";
import { saveCronState } from "../src/cronJobs.js";
import { writeExampleCronJobs } from "../src/cron_cmd.js";
import { cronMinuteKey } from "../src/cronSchedule.js";

const NOW = Date.parse("2026-06-28T12:00:00Z");
function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "cron-stale-"));
}
/** lastRun stored as a local-time cron minute key (matches cron-tick writes). */
const ranHoursAgo = (h: number) => cronMinuteKey(new Date(NOW - h * 3600_000));

test("cronCadenceHours: daily ~24h, weekly ~168h, hourly ~1h, */5 <1h", () => {
  assert.ok(Math.abs(cronCadenceHours("5 0 * * *", NOW)! - 24) < 0.1);
  assert.ok(Math.abs(cronCadenceHours("0 4 * * 0", NOW)! - 168) < 0.1);
  assert.ok(Math.abs(cronCadenceHours("0 * * * *", NOW)! - 1) < 0.1);
  assert.ok(cronCadenceHours("*/5 * * * *", NOW)! < 1);
});

test("evaluateRecurringStaleness flags only a stale daily job (I-129)", () => {
  const dir = tmp();
  writeExampleCronJobs(dir, [
    { id: "daily-stale", cron: "5 0 * * *", prompt: "x" }, // last ran 48h ago → STALE (>36h)
    { id: "daily-fresh", cron: "0 1 * * *", prompt: "x" }, // last ran 2h ago → ok
    { id: "weekly", cron: "0 4 * * 0", prompt: "x" }, // last ran 40h ago → NOT stale (cadence ~168h)
    { id: "freq", cron: "*/5 * * * *", prompt: "x" }, // frequent → not watched (cadence <12h)
    { id: "crit", cron: "5 0 * * *", prompt: "x", critical: true }, // stale but critical → covered elsewhere
    { id: "off", cron: "5 0 * * *", prompt: "x", enabled: false }, // disabled → skip
  ]);
  saveCronState(dir, {
    version: 1,
    lastRun: {
      "daily-stale": ranHoursAgo(48),
      "daily-fresh": ranHoursAgo(2),
      weekly: ranHoursAgo(40),
      crit: ranHoursAgo(48),
      off: ranHoursAgo(200),
    },
    lastResult: {},
  });

  const checks = evaluateRecurringStaleness(dir, NOW);
  assert.deepEqual(
    checks.map((c) => c.name),
    ["cron daily-stale"]
  );
  assert.equal(checks[0]!.ok, false);
  assert.match(checks[0]!.detail, /not firing/);
});

test("a daily job that never ran is flagged as stale", () => {
  const dir = tmp();
  writeExampleCronJobs(dir, [{ id: "neverran", cron: "5 0 * * *", prompt: "x" }]);
  saveCronState(dir, { version: 1, lastRun: {}, lastResult: {} });
  const checks = evaluateRecurringStaleness(dir, NOW);
  assert.equal(checks.length, 1);
  assert.match(checks[0]!.detail, /never ran/);
});
