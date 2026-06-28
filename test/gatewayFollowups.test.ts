import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { runDueFollowups, buildFollowupPrompt } from "../src/gatewayFollowups.js";
import {
  addFollowup,
  saveFollowups,
  loadFollowups,
  getFollowup,
} from "../src/gatewayFollowupStore.js";
import { loadOutbox } from "../src/gatewayOutbox.js";
import { setBackgroundPaused } from "../src/backgroundPause.js";

function sandbox() {
  const dir = mkdtempSync(resolve(tmpdir(), "gw-fur-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(join(dir, "agent.config.json"), JSON.stringify({ stateDir: ".agent" }) + "\n");
  return dir;
}

const okRunner = (text: string) => async () => ({ exitCode: 0, text });

test("fires a due follow-up → outbox, then clears it", async () => {
  const dir = sandbox();
  const r = addFollowup(dir, { chatId: "u1", adapter: "telegram", reason: "report build status", afterMinutes: 1 });
  const future = new Date(Date.now() + 2 * 60_000);
  const out = await runDueFollowups({ dir, now: future, runner: okRunner("BUILD GREEN"), onLog: () => {} });
  assert.deepEqual(out.fired, [r.followup!.id]);
  const entries = loadOutbox(dir).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.chatId, "u1");
  assert.match(entries[0]!.text, /BUILD GREEN/);
  // one-shot: cleared after firing
  assert.equal(getFollowup(dir, r.followup!.id), undefined);
});

test("the fired prompt is self-contained (carries the reason)", () => {
  const p = buildFollowupPrompt("check kubectl rollout status deploy/api and report");
  assert.match(p, /deferred follow-up/i);
  assert.match(p, /kubectl rollout status deploy\/api/);
  assert.match(p, /do NOT ask the user a question/i);
});

test("background pause blocks firing", async () => {
  const dir = sandbox();
  addFollowup(dir, { chatId: "u1", adapter: "telegram", reason: "x", afterMinutes: 1 });
  setBackgroundPaused(dir, true, "test");
  const out = await runDueFollowups({ dir, now: new Date(Date.now() + 2 * 60_000), runner: okRunner("nope"), onLog: () => {} });
  assert.equal(out.paused, true);
  assert.deepEqual(out.fired, []);
  assert.equal(loadOutbox(dir).entries.length, 0);
  // entry left intact for when pause lifts
  assert.equal(loadFollowups(dir).followups.length, 1);
});

test("prunes stale entries without firing", async () => {
  const dir = sandbox();
  const now = Date.now();
  saveFollowups(dir, {
    version: 1,
    followups: [
      { id: "fu_stale", chatId: "u1", adapter: "telegram", reason: "old", dueAt: new Date(now - 13 * 60 * 60 * 1000).toISOString(), createdAt: new Date(now - 14 * 60 * 60 * 1000).toISOString() },
    ],
  });
  const out = await runDueFollowups({ dir, now: new Date(now), runner: okRunner("should not run"), onLog: () => {} });
  assert.deepEqual(out.stale, ["fu_stale"]);
  assert.deepEqual(out.fired, []);
  assert.equal(loadOutbox(dir).entries.length, 0);
  assert.equal(loadFollowups(dir).followups.length, 0);
});

test("bounded per tick — extra due entries remain for the next tick", async () => {
  const dir = sandbox();
  for (let i = 0; i < 5; i++) {
    addFollowup(dir, { chatId: `c${i}`, adapter: "telegram", reason: `r${i}`, afterMinutes: 1 });
  }
  const out = await runDueFollowups({ dir, now: new Date(Date.now() + 2 * 60_000), max: 2, runner: okRunner("done"), onLog: () => {} });
  assert.equal(out.fired.length, 2);
  assert.equal(loadFollowups(dir).followups.length, 3); // 5 - 2 fired
});

test("a runner error notifies the user and still clears (one-shot, no loop)", async () => {
  const dir = sandbox();
  const r = addFollowup(dir, { chatId: "u1", adapter: "telegram", reason: "thing", afterMinutes: 1 });
  const boom = async () => {
    throw new Error("SDK 529 overloaded");
  };
  const out = await runDueFollowups({ dir, now: new Date(Date.now() + 2 * 60_000), runner: boom, onLog: () => {} });
  assert.deepEqual(out.failed, [r.followup!.id]);
  const entries = loadOutbox(dir).entries;
  assert.equal(entries.length, 1);
  assert.match(entries[0]!.text, /упала|529/i);
  assert.equal(getFollowup(dir, r.followup!.id), undefined); // cleared → no retry loop
});

test("an empty result notifies the user rather than sending nothing", async () => {
  const dir = sandbox();
  addFollowup(dir, { chatId: "u1", adapter: "telegram", reason: "thing", afterMinutes: 1 });
  const out = await runDueFollowups({
    dir,
    now: new Date(Date.now() + 2 * 60_000),
    runner: async () => ({ exitCode: 0, text: "   " }),
    onLog: () => {},
  });
  assert.equal(out.failed.length, 1);
  assert.match(loadOutbox(dir).entries[0]!.text, /Не смог завершить/i);
});
