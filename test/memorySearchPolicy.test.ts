import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CURSOR_TRANSCRIPT_WING } from "../src/cursorTranscriptMine.js";
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
  const base = ["cursor-ide", "secure"];
  assert.deepEqual(effectiveSearchExcludeWings(base, { includeArchive: true }), []);
  assert.deepEqual(effectiveSearchExcludeWings(base, undefined), base);
});
