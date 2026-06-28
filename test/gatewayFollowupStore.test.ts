import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  addFollowup,
  listFollowups,
  getFollowup,
  clearFollowup,
  dueFollowups,
  loadFollowups,
  saveFollowups,
  FOLLOWUPS_PER_CHAT_MAX,
  FOLLOWUPS_GLOBAL_MAX,
  FOLLOWUP_MAX_AFTER_MINUTES,
} from "../src/gatewayFollowupStore.js";

// Do NOT set IRIDA_HOME=dir (guardProdStateWrite blocks writes under home/.agent
// during npm test). loadConfig(dir) reads dir/agent.config.json directly.
function sandbox() {
  const dir = mkdtempSync(resolve(tmpdir(), "gw-fu-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(join(dir, "agent.config.json"), JSON.stringify({ stateDir: ".agent" }) + "\n");
  return dir;
}

test("add / list / get / clear a follow-up", () => {
  const dir = sandbox();
  const r = addFollowup(dir, { chatId: "u1", adapter: "telegram", reason: "check the deploy", afterMinutes: 10 });
  assert.equal(r.ok, true);
  const id = r.followup!.id;
  assert.match(id, /^fu_/);
  assert.equal(getFollowup(dir, id)?.reason, "check the deploy");
  // due ~10 min out
  const mins = (Date.parse(r.followup!.dueAt) - Date.now()) / 60000;
  assert.ok(mins > 9 && mins <= 10.5);
  // per-chat listing
  assert.equal(listFollowups(dir, "telegram", "u1").length, 1);
  assert.equal(listFollowups(dir, "telegram", "other").length, 0);
  assert.equal(clearFollowup(dir, id), true);
  assert.equal(getFollowup(dir, id), undefined);
  assert.equal(clearFollowup(dir, id), false);
});

test("rejects out-of-range after_minutes and empty reason", () => {
  const dir = sandbox();
  assert.equal(addFollowup(dir, { chatId: "u1", adapter: "telegram", reason: "x", afterMinutes: 0 }).ok, false);
  assert.equal(
    addFollowup(dir, { chatId: "u1", adapter: "telegram", reason: "x", afterMinutes: FOLLOWUP_MAX_AFTER_MINUTES + 1 }).ok,
    false
  );
  assert.equal(addFollowup(dir, { chatId: "u1", adapter: "telegram", reason: "   ", afterMinutes: 5 }).ok, false);
});

test("enforces the per-chat cap", () => {
  const dir = sandbox();
  for (let i = 0; i < FOLLOWUPS_PER_CHAT_MAX; i++) {
    assert.equal(addFollowup(dir, { chatId: "u1", adapter: "telegram", reason: `r${i}`, afterMinutes: 5 }).ok, true);
  }
  const over = addFollowup(dir, { chatId: "u1", adapter: "telegram", reason: "one too many", afterMinutes: 5 });
  assert.equal(over.ok, false);
  assert.match(over.error ?? "", /too many/i);
  // a different chat is unaffected
  assert.equal(addFollowup(dir, { chatId: "u2", adapter: "telegram", reason: "ok", afterMinutes: 5 }).ok, true);
});

test("global cap keeps the newest", () => {
  const dir = sandbox();
  // spread across many chats to dodge the per-chat cap
  for (let i = 0; i < FOLLOWUPS_GLOBAL_MAX + 3; i++) {
    addFollowup(dir, { chatId: `c${i}`, adapter: "telegram", reason: `r${i}`, afterMinutes: 5 });
  }
  assert.equal(loadFollowups(dir).followups.length, FOLLOWUPS_GLOBAL_MAX);
  const last = FOLLOWUPS_GLOBAL_MAX + 2;
  assert.ok(getFollowup, "sanity");
  assert.equal(listFollowups(dir, "telegram", `c${last}`).length, 1); // newest survived
  assert.equal(listFollowups(dir, "telegram", "c0").length, 0); // oldest evicted
});

test("dueFollowups splits due vs stale vs not-yet-due", () => {
  const dir = sandbox();
  const now = Date.now();
  // hand-write three entries: due, stale, and future
  saveFollowups(dir, {
    version: 1,
    followups: [
      { id: "fu_due", chatId: "u1", adapter: "telegram", reason: "due", dueAt: new Date(now - 60_000).toISOString(), createdAt: new Date(now - 120_000).toISOString() },
      { id: "fu_stale", chatId: "u1", adapter: "telegram", reason: "stale", dueAt: new Date(now - 13 * 60 * 60 * 1000).toISOString(), createdAt: new Date(now - 14 * 60 * 60 * 1000).toISOString() },
      { id: "fu_future", chatId: "u1", adapter: "telegram", reason: "future", dueAt: new Date(now + 60_000).toISOString(), createdAt: new Date(now).toISOString() },
    ],
  });
  const { due, stale } = dueFollowups(dir, new Date(now));
  assert.deepEqual(due.map((f) => f.id), ["fu_due"]);
  assert.deepEqual(stale.map((f) => f.id), ["fu_stale"]);
});

test("corrupt store degrades to empty", () => {
  const dir = sandbox();
  writeFileSync(join(dir, ".agent", "gateway.followups.json"), "{ broken");
  assert.deepEqual(loadFollowups(dir).followups, []);
});
