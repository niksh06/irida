import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  actionTranscriptPath,
  appendActionTranscript,
  popLastReversibleAction,
  recordMemoryDelete,
} from "../src/actionTranscript.js";
import { undoLastAction } from "../src/undoAction.js";
import { createMemoryStore } from "../src/memoryStore.js";
import { loadCronJobs, saveCronJobs } from "../src/cronJobs.js";

function tmp(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "action-tx-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  return dir;
}

test("recordMemoryDelete writes reversible entry", () => {
  const dir = tmp();
  const prev = process.env.CSAGENT_ACTION_LOG;
  process.env.CSAGENT_ACTION_LOG = "1";
  try {
    recordMemoryDelete(dir, { name: "note1", wing: "default", body: "# Hello\n", title: "Hello" });
    const path = actionTranscriptPath(dir);
    assert.equal(existsSync(path), true);
    const line = readFileSync(path, "utf8").trim();
    const parsed = JSON.parse(line) as { action: string; reversible: boolean };
    assert.equal(parsed.action, "memory.delete");
    assert.equal(parsed.reversible, true);
  } finally {
    if (prev === undefined) delete process.env.CSAGENT_ACTION_LOG;
    else process.env.CSAGENT_ACTION_LOG = prev;
  }
});

test("undoLastAction restores deleted memory note", async () => {
  const dir = tmp();
  const prev = process.env.CSAGENT_ACTION_LOG;
  process.env.CSAGENT_ACTION_LOG = "1";
  try {
    const store = createMemoryStore(dir, ".agent");
    await store.upsertNote({ name: "undo-me", body: "body text" });
    await store.close();

    recordMemoryDelete(dir, { name: "undo-me", wing: "default", body: "body text" });
    const store2 = createMemoryStore(dir, ".agent");
    await store2.deleteNote("undo-me");
    await store2.close();

    const out = await undoLastAction(dir);
    assert.equal(out.ok, true);
    assert.match(out.message, /restored/);

    const store3 = createMemoryStore(dir, ".agent");
    const note = await store3.getNote("undo-me");
    await store3.close();
    assert.equal(note?.body, "body text");
  } finally {
    if (prev === undefined) delete process.env.CSAGENT_ACTION_LOG;
    else process.env.CSAGENT_ACTION_LOG = prev;
  }
});

test("popLastReversibleAction skips non-reversible tail", () => {
  const dir = tmp();
  appendActionTranscript(dir, {
    ts: new Date().toISOString(),
    action: "cron.user.add",
    reversible: false,
    payload: { id: "x" },
  });
  appendActionTranscript(dir, {
    ts: new Date().toISOString(),
    action: "cron.user.remove",
    reversible: true,
    payload: { job: { id: "removed", cron: "0 9 * * *", prompt: "p" } },
  });
  const entry = popLastReversibleAction(dir);
  assert.equal(entry?.action, "cron.user.remove");
});

test("undoLastAction restores removed cron job", async () => {
  const dir = tmp();
  const prev = process.env.CSAGENT_ACTION_LOG;
  process.env.CSAGENT_ACTION_LOG = "1";
  try {
    saveCronJobs(dir, [{ id: "keep", cron: "0 8 * * *", prompt: "a" }]);
    appendActionTranscript(dir, {
      ts: new Date().toISOString(),
      action: "cron.user.remove",
      reversible: true,
      payload: { job: { id: "gone", cron: "0 9 * * *", prompt: "bye" } },
    });
    const out = await undoLastAction(dir);
    assert.equal(out.ok, true);
    const jobs = loadCronJobs(dir);
    assert.ok(jobs.some((j) => j.id === "gone"));
  } finally {
    if (prev === undefined) delete process.env.CSAGENT_ACTION_LOG;
    else process.env.CSAGENT_ACTION_LOG = prev;
  }
});
