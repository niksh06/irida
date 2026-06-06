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
import { loadCronState } from "../src/cronJobs.js";
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
