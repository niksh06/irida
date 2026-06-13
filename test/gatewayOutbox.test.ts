import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  drainOutbox,
  enqueueOutbox,
  loadOutbox,
  mergeOutboxAfterDrain,
  outboxBackoffMs,
  assessOutboxHealth,
  formatOutboxStatusDetail,
  summarizeOutbox,
  sendOutboxParkAck,
  OUTBOX_PARK_ACK_TEXT,
  OUTBOX_STALE_MS,
  resolveOutboxDeliveryFormat,
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

test("mergeOutboxAfterDrain preserves entries enqueued during drain", () => {
  const dir = tmp();
  enqueueOutbox(dir, { chatId: "42", text: "concurrent" });
  const merged = mergeOutboxAfterDrain(dir, new Set(["out_snapshot_only"]), []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.text, "concurrent");
});

test("drain preserves entries enqueued while send is in flight", async () => {
  const dir = tmp();
  enqueueOutbox(dir, { chatId: "42", text: "due" });
  const now = new Date();
  let releaseSend: (() => void) | undefined;
  const sendStarted = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });

  const drainPromise = drainOutbox(
    dir,
    async () => {
      releaseSend?.();
      await new Promise((r) => setTimeout(r, 30));
    },
    { now }
  );

  await sendStarted;
  enqueueOutbox(dir, { chatId: "42", text: "concurrent" });
  const result = await drainPromise;

  assert.equal(result.sent, 1);
  assert.equal(result.remaining, 1);
  const entries = loadOutbox(dir).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.text, "concurrent");
});

test("resolveOutboxDeliveryFormat downgrades rich after message is too long", () => {
  const entry: OutboxEntry = {
    id: "out_x",
    chatId: "42",
    text: "long",
    format: "rich",
    createdAt: new Date().toISOString(),
    attempts: 3,
    nextAttemptAt: new Date().toISOString(),
    lastError: "Bad Request: message is too long",
  };
  assert.equal(resolveOutboxDeliveryFormat(entry), "plain");
});

test("drain retries rich outbox as plain after too-long error", async () => {
  const dir = tmp();
  const now = new Date();
  saveOutbox(dir, {
    version: 1,
    entries: [
      {
        id: "out_stuck",
        chatId: "42",
        text: "y".repeat(5408),
        format: "rich",
        createdAt: now.toISOString(),
        attempts: 2,
        nextAttemptAt: now.toISOString(),
        lastError: "Bad Request: message is too long",
      },
    ],
  });
  let seenFormat: string | undefined;
  const result = await drainOutbox(
    dir,
    async (e) => {
      seenFormat = resolveOutboxDeliveryFormat(e);
    },
    { now }
  );
  assert.equal(result.sent, 1);
  assert.equal(seenFormat, "plain");
  assert.equal(loadOutbox(dir).entries.length, 0);
});

test("enqueue succeeds after outbox clobbered by concurrent writer", () => {
  const dir = tmp();
  enqueueOutbox(dir, { chatId: "42", text: "first" });
  saveOutbox(dir, { version: 1, entries: [] });
  const second = enqueueOutbox(dir, { chatId: "42", text: "second" });
  const entries = loadOutbox(dir).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.id, second.id);
  assert.equal(entries[0]!.text, "second");
});

test("assessOutboxHealth empty is ok", () => {
  const dir = tmp();
  const h = assessOutboxHealth(dir);
  assert.equal(h.ok, true);
  assert.equal(h.detail, "empty");
});

test("assessOutboxHealth FAIL when oldest pending exceeds stale threshold", () => {
  const dir = tmp();
  const now = new Date();
  saveOutbox(dir, {
    version: 1,
    entries: [
      {
        id: "out_stale",
        chatId: "42",
        text: "stuck",
        createdAt: new Date(now.getTime() - OUTBOX_STALE_MS - 60_000).toISOString(),
        attempts: 1,
        nextAttemptAt: now.toISOString(),
      },
    ],
  });
  const h = assessOutboxHealth(dir, now);
  assert.equal(h.ok, false);
  assert.match(h.detail, /1 pending/);
  assert.match(h.detail, /oldest 6m/);
});

test("summarizeOutbox reports next retry delay", () => {
  const now = new Date();
  const summary = summarizeOutbox(
    [
      {
        id: "out_1",
        chatId: "42",
        text: "x",
        createdAt: now.toISOString(),
        attempts: 1,
        nextAttemptAt: new Date(now.getTime() + 45_000).toISOString(),
      },
    ],
    now
  );
  assert.equal(summary.count, 1);
  assert.equal(summary.stale, false);
  assert.match(formatOutboxStatusDetail(summary), /next retry ~45s/);
});

test("sendOutboxParkAck sends ack text once", async () => {
  const sent: string[] = [];
  const logs: string[] = [];
  await sendOutboxParkAck(async (t) => {
    sent.push(t);
  }, (l) => logs.push(l), "out_test");
  assert.deepEqual(sent, [OUTBOX_PARK_ACK_TEXT]);
  assert.match(logs[0] ?? "", /id=out_test ack sent/);
});
