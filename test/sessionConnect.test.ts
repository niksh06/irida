import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/store.js";
import { replayPreamble } from "../src/sessionConnect.js";

test("replayPreamble truncates long transcript", async () => {
  const dir = mkdtempSync(join(tmpdir(), "replay-"));
  const store = createStore(dir, ".agent");
  const sessionId = "sess_replay_test";
  try {
    await store.upsertSession({
      id: sessionId,
      title: "t",
      cwd: dir,
      runtime: "local",
      sdk_agent_id: null,
      last_status: "ok",
      channel: "cli",
    });
    for (let i = 0; i < 5; i++) {
      await store.recordRun({
        id: `run_${i}`,
        session_id: sessionId,
        sdk_agent_id: "a1",
        sdk_run_id: `r${i}`,
        prompt_preview: `question ${i} `.repeat(200),
        result_preview: `answer ${i} `.repeat(400),
        status: "finished",
        error_kind: null,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        cwd: dir,
        runtime: "local",
        model: "m",
      });
    }
    const preamble = await replayPreamble(store, sessionId, 5, 500);
    assert.ok(preamble.length <= 700);
    assert.match(preamble, /truncated/);
  } finally {
    await store.close();
  }
});
