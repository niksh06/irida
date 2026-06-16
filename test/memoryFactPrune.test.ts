import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createMemoryStore } from "../src/memoryStore.js";
import { resolveMemoryRoot } from "../src/config.js";
import { pruneSeenPostFacts, purgeAllSeenPostFacts, purgeMalformedSubjectFacts } from "../src/memoryFactPrune.js";
import { MemoryFactValidationError } from "../src/memoryFactValidate.js";

test("pruneCurrentFacts invalidates old seen_post facts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memprune-"));
  const store = createMemoryStore(dir, ".agent");
  try {
    const old = await store.addFact({
      subject: "seen_post",
      predicate: "123",
      object: "1",
    });
    const recent = await store.addFact({
      subject: "seen_post",
      predicate: "456",
      object: "2",
    });
    const stateRoot = resolveMemoryRoot(dir);
    const db = new DatabaseSync(resolve(stateRoot, "state.sqlite"));
    const stale = new Date(Date.now() - 31 * 86400000).toISOString();
    db.prepare(`UPDATE memory_facts SET created_at=? WHERE id=?`).run(stale, old.id);
    db.close();

    const dry = await pruneSeenPostFacts(dir, { olderThanDays: 30, dryRun: true });
    assert.equal(dry.matched, 1);
    assert.equal(dry.pruned, 0);

    const pruned = await pruneSeenPostFacts(dir, { olderThanDays: 30 });
    assert.equal(pruned.matched, 1);
    assert.equal(pruned.pruned, 1);

    const current = await store.queryFacts({ subject: "seen_post" });
    assert.equal(current.length, 1);
    assert.equal(current[0]!.id, recent.id);
  } finally {
    await store.close();
  }
});

test("purgeAllSeenPostFacts invalidates every current seen_post", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memprune-"));
  const store = createMemoryStore(dir, ".agent");
  try {
    await store.addFact({ subject: "seen_post", predicate: "1", object: "a" });
    await store.addFact({ subject: "seen_post", predicate: "2", object: "b" });
    const dry = await purgeAllSeenPostFacts(dir, { dryRun: true });
    assert.equal(dry.matched, 2);
    assert.equal(dry.pruned, 0);
    const purged = await purgeAllSeenPostFacts(dir);
    assert.equal(purged.matched, 2);
    assert.equal(purged.pruned, 2);
    assert.equal((await store.queryFacts({ subject: "seen_post", currentOnly: true })).length, 0);
  } finally {
    await store.close();
  }
});

test("addFact rejects malformed subject and purge clears legacy rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memprune-mal-"));
  const store = createMemoryStore(dir, ".agent");
  try {
    const stateRoot = resolveMemoryRoot(dir);
    const db = new DatabaseSync(resolve(stateRoot, "state.sqlite"));
    db.prepare(
      `INSERT INTO memory_facts (id, subject, predicate, object, valid_from, valid_to, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("fact_bad", "--subject", "x", "y", null, null, "test", new Date().toISOString());
    db.close();

    await assert.rejects(
      () => store.addFact({ subject: "--dry-run", predicate: "p", object: "o" }),
      MemoryFactValidationError
    );

    const dry = await purgeMalformedSubjectFacts(dir, { dryRun: true });
    assert.equal(dry.matched, 1);
    assert.equal(dry.pruned, 0);

    const purged = await purgeMalformedSubjectFacts(dir);
    assert.equal(purged.matched, 1);
    assert.equal(purged.pruned, 1);
    assert.equal(await store.countMalformedSubjectFacts(), 0);
  } finally {
    await store.close();
  }
});
