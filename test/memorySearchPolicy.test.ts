import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CURSOR_TRANSCRIPT_WING } from "../src/cursorTranscriptMine.js";
import { EPISODIC_WING } from "../src/memoryWings.js";
import { effectiveSearchExcludeWings } from "../src/memorySearchPolicy.js";
import { createMemoryStore } from "../src/memoryStore.js";

test("searchNotes excludes cursor-ide by default", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-search-excl-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  const memory = createMemoryStore(dir);
  try {
    await memory.upsertNote({
      name: "ops-gateway",
      wing: "default",
      title: "Gateway cron",
      body: "gateway cron tick launchd troubleshooting",
    });
    await memory.upsertNote({
      name: "cursor.test",
      wing: CURSOR_TRANSCRIPT_WING,
      title: "Cursor chat",
      body: "gateway cron long transcript archive",
    });
    const hits = await memory.searchNotes("gateway cron", 10);
    assert.ok(hits.some((n) => n.name === "ops-gateway"));
    assert.ok(!hits.some((n) => n.wing === CURSOR_TRANSCRIPT_WING));
    const archive = await memory.searchNotes("gateway cron", 10, { includeArchive: true });
    assert.ok(archive.some((n) => n.wing === CURSOR_TRANSCRIPT_WING));
  } finally {
    await memory.close();
  }
});

test("effectiveSearchExcludeWings honors includeArchive", () => {
  const base = ["cursor-ide", "secure", "episodic"];
  assert.deepEqual(effectiveSearchExcludeWings(base, { includeArchive: true }), []);
  assert.deepEqual(effectiveSearchExcludeWings(base, undefined), base);
});

test("effectiveSearchExcludeWings honors includeEpisodic", () => {
  const base = ["cursor-ide", "secure", "episodic"];
  assert.deepEqual(effectiveSearchExcludeWings(base, { includeEpisodic: true }), [
    "cursor-ide",
    "secure",
  ]);
});

test("searchNotes excludes episodic by default", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-search-ep-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  const memory = createMemoryStore(dir);
  try {
    await memory.upsertNote({
      name: "reddit-feeds",
      wing: "default",
      title: "Reddit RSS",
      body: "reddit feeds sub list tparser",
    });
    await memory.upsertNote({
      name: "ep.sess_test",
      wing: EPISODIC_WING,
      title: "Session chat",
      body: "reddit feeds episodic noise from session ingest",
    });
    const hits = await memory.searchNotes("reddit feeds", 10);
    assert.ok(hits.some((n) => n.name === "reddit-feeds"));
    assert.ok(!hits.some((n) => n.wing === EPISODIC_WING));
    const withEp = await memory.searchNotes("reddit feeds", 10, { includeEpisodic: true });
    assert.ok(withEp.some((n) => n.wing === EPISODIC_WING));
  } finally {
    await memory.close();
  }
});

test("searchNotes wings allow-list overrides default exclude", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-search-wing-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );
  const memory = createMemoryStore(dir);
  try {
    await memory.upsertNote({
      name: "ops-gateway",
      wing: "default",
      title: "Gateway cron",
      body: "gateway cron tick launchd",
    });
    await memory.upsertNote({
      name: "lesson.gateway",
      wing: "cursor-lesson",
      title: "Gateway lesson",
      body: "gateway cron idle rotation playbook",
    });
    await memory.upsertNote({
      name: "cursor.test",
      wing: CURSOR_TRANSCRIPT_WING,
      title: "Archive",
      body: "gateway cron raw transcript archive",
    });
    const opsOnly = await memory.searchNotes("gateway cron", 10, {
      wings: ["default", "cursor-lesson"],
    });
    assert.ok(opsOnly.some((n) => n.name === "ops-gateway"));
    assert.ok(opsOnly.some((n) => n.name === "lesson.gateway"));
    assert.ok(!opsOnly.some((n) => n.wing === CURSOR_TRANSCRIPT_WING));
    const archiveOnly = await memory.searchNotes("gateway cron", 10, {
      wings: [CURSOR_TRANSCRIPT_WING],
    });
    assert.equal(archiveOnly.length, 1);
    assert.equal(archiveOnly[0]!.name, "cursor.test");
  } finally {
    await memory.close();
  }
});
