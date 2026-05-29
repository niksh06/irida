import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Store } from "../src/store.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "store-"));
}

test("upsert + list sessions newest first", () => {
  const dir = tmp();
  const s = new Store(dir, ".agent");
  s.upsertSession({ id: "sess_a", title: "first", cwd: dir, runtime: "local", last_status: "finished" });
  s.upsertSession({ id: "sess_b", title: "second", cwd: dir, runtime: "local", last_status: "finished" });
  const rows = s.listSessions();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "sess_b"); // newest first
  s.close();
});

test("recordRun stores metadata and redacts secrets in preview", () => {
  const dir = tmp();
  const s = new Store(dir, ".agent");
  s.upsertSession({ id: "sess_x", title: "t", cwd: dir, runtime: "local" });
  s.recordRun({
    id: "run_1",
    session_id: "sess_x",
    sdk_agent_id: "a1",
    sdk_run_id: "r1",
    prompt_preview: "use CURSOR_API_KEY=key_abcdef123456 now",
    status: "finished",
    error_kind: null,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    cwd: dir,
    runtime: "local",
    model: "composer-2.5",
  });
  const runs = s.listRuns("sess_x");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "finished");
  assert.doesNotMatch(runs[0].prompt_preview, /key_abcdef123456/);
  assert.match(runs[0].prompt_preview, /<redacted>/);
  s.close();
});
