import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildRunLogMeta,
  inferIsTestRun,
  normalizeRunLogChannel,
} from "../src/runContext.js";
import { runRecordToLogEntry } from "../src/runLog.js";
import type { RunRecord } from "../src/store.js";
import { SESSION_CHANNEL } from "../src/sessionChannel.js";

describe("runContext", () => {
  test("inferIsTestRun detects temp test dirs and CSAGENT_TEST", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rotate-fail-"));
    assert.equal(inferIsTestRun(tmp), true);
    assert.equal(inferIsTestRun("/Users/nsh/.csagent/csagent"), false);
    const prev = process.env.CSAGENT_TEST;
    process.env.CSAGENT_TEST = "1";
    try {
      assert.equal(inferIsTestRun("/any/path"), true);
    } finally {
      if (prev === undefined) delete process.env.CSAGENT_TEST;
      else process.env.CSAGENT_TEST = prev;
    }
  });

  test("buildRunLogMeta sets channel, cron_job, is_test", () => {
    const meta = buildRunLogMeta({
      channel: SESSION_CHANNEL.cron,
      cronJob: "introspection-weekly",
      cwd: "/Users/nsh/.csagent/csagent",
    });
    assert.equal(meta.channel, "cron");
    assert.equal(meta.cron_job, "introspection-weekly");
    assert.equal(meta.is_test, false);
  });

  test("normalizeRunLogChannel maps unknown to unknown", () => {
    assert.equal(normalizeRunLogChannel("telegram"), "telegram");
    assert.equal(normalizeRunLogChannel(""), "unknown");
    assert.equal(normalizeRunLogChannel("weird"), "unknown");
  });

  test("runRecordToLogEntry includes I-68 fields", () => {
    const record: RunRecord = {
      id: "run_x",
      session_id: "sess_x",
      sdk_agent_id: null,
      sdk_run_id: null,
      prompt_preview: "p",
      result_preview: "r",
      status: "finished",
      error_kind: null,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      cwd: "/tmp/rotate-fail-abc",
      runtime: "local",
      model: "m",
      channel: "cron",
      cron_job: "cursor-mine-daily",
      is_test: true,
    };
    const entry = runRecordToLogEntry(record);
    assert.equal(entry.channel, "cron");
    assert.equal(entry.cron_job, "cursor-mine-daily");
    assert.equal(entry.is_test, true);
  });
});
