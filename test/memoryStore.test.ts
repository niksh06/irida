import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore } from "../src/memoryStore.js";

test("memory store FTS search ranks token matches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memfts-"));
  const store = createMemoryStore(dir, ".agent");
  try {
    await store.upsertNote({ name: "alpha", body: "# Alpha\nlaunchd gateway digest.", wing: "ops" });
    await store.upsertNote({ name: "beta", body: "# Beta\nunrelated kafka notes.", wing: "ops" });
    const hits = await store.searchNotes("launchd digest");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.name, "alpha");
  } finally {
    await store.close();
  }
});

test("memory store notes CRUD", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memstore-"));
  const store = createMemoryStore(dir, ".agent");
  try {
    await store.upsertNote({ name: "ops", body: "# Ops\nGateway runs on launchd.", wing: "csagent" });
    const listed = await store.listNotes();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.wing, "csagent");
    const hits = await store.searchNotes("launchd");
    assert.equal(hits.length, 1);
    assert.ok(await store.deleteNote("ops"));
  } finally {
    await store.close();
  }
});

test("memory store facts temporal query", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memfact-"));
  const store = createMemoryStore(dir, ".agent");
  try {
    const f = await store.addFact({
      subject: "seen_post",
      predicate: "telegram",
      object: "msg-99",
    });
    const current = await store.queryFacts({ subject: "seen_post", predicate: "telegram" });
    assert.equal(current.length, 1);
    assert.equal(current[0]!.object, "msg-99");
    assert.ok(await store.invalidateFact(f.id));
    const after = await store.queryFacts({ subject: "seen_post", predicate: "telegram" });
    assert.equal(after.length, 0);
  } finally {
    await store.close();
  }
});
