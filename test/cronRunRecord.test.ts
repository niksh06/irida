import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildCronJobLastResult,
  formatCronPostMortem,
  formatDurationMs,
  saveCronJobResult,
} from "../src/cronRunRecord.js";
import { loadCronState, saveCronState, mutateCronState } from "../src/cronJobs.js";
import { EXIT } from "../src/exit.js";

test("formatDurationMs renders human durations", () => {
  assert.equal(formatDurationMs(500), "500ms");
  assert.equal(formatDurationMs(45000), "45s");
  assert.equal(formatDurationMs(125000), "2m 5s");
});

test("formatCronPostMortem includes topic breakdown", () => {
  const text = formatCronPostMortem(
    "tparser-daily-digest",
    {
      ok: true,
      exitCode: EXIT.ok,
      message: "finished",
      durationMs: 120_000,
      topicSummaries: [
        { topicId: "ai-ml", title: "AI/ML", ok: true, summary: "x" },
        { topicId: "aisec", title: "AISec", ok: false, summary: "fail" },
      ],
    },
    new Date("2026-05-29T23:59:00.000Z")
  );
  assert.match(text, /post-mortem/);
  assert.match(text, /topics: 1\/2/);
  assert.match(text, /aisec✗/);
  assert.match(text, /2m/);
});

test("saveCronJobResult persists lastResult in cron.state.json", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cron-record-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ stateDir: ".agent", cwd: dir }),
    "utf8"
  );
  saveCronJobResult(dir, "digest", {
    ok: false,
    exitCode: EXIT.software,
    message: "boom",
    durationMs: 3000,
  });
  const state = loadCronState(dir);
  assert.equal(state.lastResult?.digest?.ok, false);
  assert.equal(state.lastResult?.digest?.durationMs, 3000);
  const raw = JSON.parse(readFileSync(join(dir, ".agent", "cron.state.json"), "utf8"));
  assert.ok(raw.lastResult?.digest);
});

test("mutateCronState re-reads so a stale snapshot can't clobber lastResult (I-132)", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cron-mutate-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ stateDir: ".agent", cwd: dir }),
    "utf8"
  );
  const OLD = new Date("2026-06-22T10:40:00Z");
  const FRESH = new Date("2026-06-29T23:59:00Z");

  // 1. cron-tick loads ONE state snapshot at the top of the tick…
  saveCronJobResult(dir, "tparser-daily-digest", { ok: true, exitCode: EXIT.ok, message: "old", durationMs: 1 }, OLD);
  const tickSnapshot = loadCronState(dir);

  // 2. …then the long (15-min) digest finishes and writes its FRESH result to disk.
  saveCronJobResult(dir, "tparser-daily-digest", { ok: true, exitCode: EXIT.ok, message: "fresh", durationMs: 300_000 }, FRESH);

  // Repro: the old cron-tick pattern re-saved the stale in-memory snapshot for the
  // next job → it clobbered the digest's fresh result back to OLD (the prod freeze).
  saveCronState(dir, tickSnapshot);
  assert.equal(loadCronState(dir).lastResult?.["tparser-daily-digest"]?.at, OLD.toISOString());

  // Fix: route the lastRun write through mutateCronState (re-read → mutate → save),
  // so it only touches its own field and never clobbers a concurrently-written one.
  saveCronJobResult(dir, "tparser-daily-digest", { ok: true, exitCode: EXIT.ok, message: "fresh", durationMs: 300_000 }, FRESH);
  mutateCronState(dir, (s) => {
    s.lastRun["reddit-digest-daily"] = "2026-06-29T2359";
  });
  const after = loadCronState(dir);
  assert.equal(after.lastResult?.["tparser-daily-digest"]?.at, FRESH.toISOString()); // preserved
  assert.equal(after.lastRun?.["reddit-digest-daily"], "2026-06-29T2359"); // and lastRun set
});

test("buildCronJobLastResult copies topic stats", () => {
  const r = buildCronJobLastResult({
    ok: true,
    exitCode: EXIT.ok,
    message: "ok",
    durationMs: 1,
    topicSummaries: [{ topicId: "a", title: "A", ok: true, summary: "s" }],
  });
  assert.equal(r.topicOk, 1);
  assert.equal(r.topicTotal, 1);
});
