import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  drainOutbox,
  enqueueOutbox,
  loadOutbox,
  outboxBackoffMs,
  saveOutbox,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_MAX_ENTRIES,
  type OutboxEntry,
} from "../src/gatewayOutbox.js";

function tmp(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "outbox-"));
  writeFileSync(resolve(dir, "agent.config.json"), JSON.stringify({ stateDir: ".agent", cwd: dir }), "utf8");
  return dir;
}

test("enqueue + drain success removes entry", async () => {
  const dir = tmp();
  enqueueOutbox(dir, { chatId: "42", text: "hello", html: true });
  assert.equal(loadOutbox(dir).entries.length, 1);
  const sent: OutboxEntry[] = [];
  const result = await drainOutbox(dir, async (e) => {
    sent.push(e);
  });
  assert.equal(result.sent, 1);
  assert.equal(result.remaining, 0);
  assert.equal(sent[0]!.chatId, "42");
  assert.equal(sent[0]!.html, true);
  assert.equal(loadOutbox(dir).entries.length, 0);
});

test("drain failure applies backoff and keeps entry", async () => {
  const dir = tmp();
  enqueueOutbox(dir, { chatId: "42", text: "x" });
  const now = new Date();
  const r1 = await drainOutbox(dir, async () => {
    throw new Error("network down");
  }, { now });
  assert.equal(r1.failed, 1);
  const after = loadOutbox(dir).entries[0]!;
  assert.equal(after.attempts, 1);
  assert.match(after.lastError ?? "", /network down/);
  assert.ok(Date.parse(after.nextAttemptAt) >= now.getTime() + outboxBackoffMs(1));

  // Not due yet → untouched.
  const r2 = await drainOutbox(dir, async () => {
    throw new Error("should not be called");
  }, { now });
  assert.equal(r2.failed, 0);
  assert.equal(r2.remaining, 1);

  // Due after backoff → retried.
  const later = new Date(now.getTime() + outboxBackoffMs(1) + 1000);
  const r3 = await drainOutbox(dir, async () => {}, { now: later });
  assert.equal(r3.sent, 1);
  assert.equal(loadOutbox(dir).entries.length, 0);
});

test("entries past attempt cap or TTL are dropped", async () => {
  const dir = tmp();
  const now = new Date();
  const stale: OutboxEntry = {
    id: "out_old",
    chatId: "42",
    text: "ancient",
    html: false,
    createdAt: new Date(now.getTime() - 49 * 3600_000).toISOString(),
    attempts: 1,
    nextAttemptAt: now.toISOString(),
  };
  const exhausted: OutboxEntry = {
    id: "out_tries",
    chatId: "42",
    text: "tried too much",
    html: false,
    createdAt: now.toISOString(),
    attempts: OUTBOX_MAX_ATTEMPTS,
    nextAttemptAt: now.toISOString(),
  };
  saveOutbox(dir, { version: 1, entries: [stale, exhausted] });
  const droppedIds: string[] = [];
  const result = await drainOutbox(dir, async () => {}, {
    now,
    onDrop: (e) => droppedIds.push(e.id),
  });
  assert.equal(result.dropped, 2);
  assert.deepEqual(droppedIds.sort(), ["out_old", "out_tries"]);
  assert.equal(loadOutbox(dir).entries.length, 0);
});

test("outbox capped at max entries (oldest evicted)", () => {
  const dir = tmp();
  for (let i = 0; i < OUTBOX_MAX_ENTRIES + 5; i++) {
    enqueueOutbox(dir, { chatId: "42", text: `m${i}` }, new Date(Date.now() + i * 1000));
  }
  const entries = loadOutbox(dir).entries;
  assert.equal(entries.length, OUTBOX_MAX_ENTRIES);
  assert.ok(!entries.some((e) => e.text === "m0"));
});
