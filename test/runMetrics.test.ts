import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { computeRunMetrics, formatRunMetrics, loadRunMetrics, parseRunLogLines } from "../src/runMetrics.js";
import { createStore } from "../src/store.js";
import type { RunLogEntry } from "../src/runLog.js";

function entry(over: Partial<RunLogEntry>): RunLogEntry {
  return {
    ts: new Date().toISOString(),
    run_id: "r",
    session_id: "s",
    sdk_run_id: null,
    status: "finished",
    error_kind: null,
    duration_ms: 1000,
    model: "m",
    runtime: "local",
    cwd: "/",
    input_tokens: null,
    output_tokens: null,
    ...over,
  };
}

test("computeRunMetrics aggregates p50/p95, errors, tokens", () => {
  const now = Date.now();
  const entries = [
    entry({ duration_ms: 100, input_tokens: 10, output_tokens: 5 }),
    entry({ duration_ms: 200 }),
    entry({ duration_ms: 300 }),
    entry({ duration_ms: 10_000, status: "error", error_kind: "run_error" }),
    // outside window:
    entry({ ts: new Date(now - 48 * 3600_000).toISOString(), duration_ms: 9 }),
    // injected context — not a turn:
    entry({ status: "injected" }),
  ];
  const m = computeRunMetrics(entries, now - 24 * 3600_000);
  assert.equal(m.runs, 4);
  assert.equal(m.errors, 1);
  assert.equal(m.errorRate, 0.25);
  assert.equal(m.p50Ms, 200);
  assert.equal(m.p95Ms, 10_000);
  assert.equal(m.inputTokens, 10);
  assert.equal(m.outputTokens, 5);
  assert.match(formatRunMetrics(m), /4 run\(s\) · err 25% · p50 200ms · p95 10\.0s/);
});

test("computeRunMetrics prodOnly excludes is_test runs", () => {
  const now = Date.now();
  const entries = [
    entry({ duration_ms: 100 }),
    entry({ duration_ms: 200, is_test: true, status: "error", error_kind: "run_error" }),
  ];
  const all = computeRunMetrics(entries, now - 24 * 3600_000);
  assert.equal(all.runs, 2);
  assert.equal(all.errors, 1);
  const prod = computeRunMetrics(entries, now - 24 * 3600_000, { prodOnly: true });
  assert.equal(prod.runs, 1);
  assert.equal(prod.errors, 0);
});

test("parseRunLogLines skips torn lines", () => {
  const body = `${JSON.stringify(entry({}))}\n{"broken\n${JSON.stringify(entry({}))}\n`;
  assert.equal(parseRunLogLines(body).length, 2);
});

test("loadRunMetrics reads jsonl written by createStore", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "metrics-"));
  const s = createStore(dir, ".agent");
  await s.upsertSession({ id: "sess_m", title: "t", cwd: dir, runtime: "local" });
  await s.recordRun({
    id: "run_m1",
    session_id: "sess_m",
    sdk_agent_id: null,
    sdk_run_id: null,
    prompt_preview: "p",
    result_preview: "r",
    status: "finished",
    error_kind: null,
    started_at: new Date(Date.now() - 2000).toISOString(),
    finished_at: new Date().toISOString(),
    cwd: dir,
    runtime: "local",
    model: "m",
    input_tokens: 42,
    output_tokens: 7,
  });
  await s.close();
  const m = loadRunMetrics(dir, ".agent", 24);
  assert.equal(m.runs, 1);
  assert.equal(m.inputTokens, 42);
  assert.equal(m.outputTokens, 7);
  assert.ok((m.p50Ms ?? 0) >= 1000);
});
