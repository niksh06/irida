import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  collectArchivePurgeCandidates,
  DEFAULT_ARCHIVE_RETENTION_DAYS,
  purgeArchiveNotes,
} from "../src/memoryArchivePurge.js";
import { resolveMemoryRoot } from "../src/config.js";
import { createMemoryStore } from "../src/memoryStore.js";
import { CURSOR_LESSON_WING, CURSOR_TRANSCRIPT_WING } from "../src/memoryWings.js";

function setupDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "purge-archive-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  return dir;
}

function patchUpdatedAt(dir: string, name: string, iso: string): void {
  const db = new DatabaseSync(resolve(resolveMemoryRoot(dir), "state.sqlite"));
  db.prepare(`UPDATE memory_notes SET updated_at=? WHERE name=?`).run(iso, name);
  db.close();
}

test("collectArchivePurgeCandidates respects TTL", async () => {
  const dir = setupDir();
  const store = createMemoryStore(dir);
  try {
    await store.upsertNote({
      name: "cursor.old",
      wing: CURSOR_TRANSCRIPT_WING,
      title: "old",
      body: "x",
    });
    await store.upsertNote({
      name: "cursor.new",
      wing: CURSOR_TRANSCRIPT_WING,
      title: "new",
      body: "y",
    });
    patchUpdatedAt(dir, "cursor.old", new Date(Date.now() - 200 * 86_400_000).toISOString());

    const candidates = await collectArchivePurgeCandidates(store, {
      olderThanDays: DEFAULT_ARCHIVE_RETENTION_DAYS,
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.name, "cursor.old");
  } finally {
    await store.close();
  }
});

test("requireLesson skips archive without lesson note", async () => {
  const dir = setupDir();
  const store = createMemoryStore(dir);
  try {
    await store.upsertNote({
      name: "cursor.aaa",
      wing: CURSOR_TRANSCRIPT_WING,
      title: "a",
      body: "x",
    });
    patchUpdatedAt(dir, "cursor.aaa", new Date(Date.now() - 40 * 86_400_000).toISOString());

    const withoutLesson = await collectArchivePurgeCandidates(store, {
      olderThanDays: 30,
      requireLesson: true,
    });
    assert.equal(withoutLesson.length, 0);

    await store.upsertNote({
      name: "lesson.aaa",
      wing: CURSOR_LESSON_WING,
      title: "lesson",
      body: "playbook",
    });
    const withLesson = await collectArchivePurgeCandidates(store, {
      olderThanDays: 30,
      requireLesson: true,
    });
    assert.equal(withLesson.length, 1);
  } finally {
    await store.close();
  }
});

test("purgeArchiveNotes dry-run does not delete", async () => {
  const dir = setupDir();
  const store = createMemoryStore(dir);
  try {
    await store.upsertNote({
      name: "cursor.delme",
      wing: CURSOR_TRANSCRIPT_WING,
      title: "d",
      body: "x",
    });
    patchUpdatedAt(dir, "cursor.delme", new Date(Date.now() - 40 * 86_400_000).toISOString());

    const dry = await purgeArchiveNotes(dir, { olderThanDays: 30 });
    assert.equal(dry.dryRun, true);
    assert.ok(dry.matched >= 1);
    assert.equal(dry.deleted, 0);
    assert.ok(await store.getNote("cursor.delme"));

    const applied = await purgeArchiveNotes(dir, { olderThanDays: 30, apply: true });
    assert.equal(applied.deleted, applied.matched);
    assert.equal(await store.getNote("cursor.delme"), undefined);
  } finally {
    await store.close();
  }
});
