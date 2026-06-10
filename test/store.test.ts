import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteStore, createStore } from "../src/store.js";
import { runLogPath } from "../src/runLog.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "store-"));
}

test("upsert + list sessions newest first", async () => {
  const dir = tmp();
  const s = new SqliteStore(dir, ".agent");
  await s.upsertSession({ id: "sess_a", title: "first", cwd: dir, runtime: "local", last_status: "finished" });
  await s.upsertSession({ id: "sess_b", title: "second", cwd: dir, runtime: "local", last_status: "finished" });
  const rows = await s.listSessions();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "sess_b");
  await s.close();
});

test("recordRun stores metadata and redacts secrets in preview", async () => {
  const dir = tmp();
  const s = new SqliteStore(dir, ".agent");
  await s.upsertSession({ id: "sess_x", title: "t", cwd: dir, runtime: "local" });
  await s.recordRun({
    id: "run_1",
    session_id: "sess_x",
    sdk_agent_id: "a1",
    sdk_run_id: "r1",
    prompt_preview: "use CURSOR_API_KEY=key_abcdef123456 now",
    result_preview: "ok done",
    status: "finished",
    error_kind: null,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    cwd: dir,
    runtime: "local",
    model: "composer-2.5",
  });
  const runs = await s.listRuns("sess_x");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "finished");
  assert.doesNotMatch(runs[0].prompt_preview, /key_abcdef123456/);
  assert.match(runs[0].prompt_preview, /<redacted>/);
  await s.close();
});

test("createStore appends JSONL run log on recordRun (I-19)", async () => {
  const dir = tmp();
  const s = createStore(dir, ".agent");
  await s.upsertSession({ id: "sess_jl", title: "t", cwd: dir, runtime: "local" });
  const startedAt = new Date(Date.now() - 1500).toISOString();
  await s.recordRun({
    id: "run_jl1",
    session_id: "sess_jl",
    sdk_agent_id: "a1",
    sdk_run_id: "r1",
    prompt_preview: "hello",
    result_preview: "world",
    status: "finished",
    error_kind: null,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    cwd: dir,
    runtime: "local",
    model: "composer-2.5",
  });
  await s.close();
  const body = readFileSync(runLogPath(dir, ".agent"), "utf8").trim();
  const entry = JSON.parse(body) as Record<string, unknown>;
  assert.equal(entry.run_id, "run_jl1");
  assert.equal(entry.session_id, "sess_jl");
  assert.equal(entry.status, "finished");
  assert.ok(typeof entry.duration_ms === "number" && entry.duration_ms >= 1000);
  // No previews in the ops log — secrets stay in the store.
  assert.doesNotMatch(body, /hello|world/);
});

test("recordRun stores error_detail redacted", async () => {
  const dir = tmp();
  const s = new SqliteStore(dir, ".agent");
  await s.upsertSession({ id: "sess_e", title: "t", cwd: dir, runtime: "local" });
  await s.recordRun({
    id: "run_err",
    session_id: "sess_e",
    sdk_agent_id: null,
    sdk_run_id: null,
    prompt_preview: "p",
    result_preview: "",
    status: "error",
    error_kind: "run_error",
    error_detail: "failed: CURSOR_API_KEY=secret_key_abcdef123456",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    cwd: dir,
    runtime: "local",
    model: "composer-2.5",
  });
  const runs = await s.listRuns("sess_e");
  assert.equal(runs[0]!.error_detail?.includes("secret_key"), false);
  assert.match(runs[0]!.error_detail ?? "", /<redacted>/);
  await s.close();
});

test("createStore defaults to sqlite", async () => {
  const prev = process.env.CSAGENT_DATABASE_URL;
  delete process.env.CSAGENT_DATABASE_URL;
  const dir = tmp();
  const s = createStore(dir, ".agent");
  await s.upsertSession({ id: "sess_z", title: "z", cwd: dir, runtime: "local" });
  const rows = await s.listSessions();
  assert.equal(rows.length, 1);
  await s.close();
  if (prev === undefined) delete process.env.CSAGENT_DATABASE_URL;
  else process.env.CSAGENT_DATABASE_URL = prev;
});
