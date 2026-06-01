import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadConfig, resolveMemoryRoot } from "../src/config.js";
import {
  deleteMemory,
  expandMemoryRefs,
  listMemories,
  listMemoryRefs,
  MemoryError,
  memoryDir,
  readMemory,
  saveMemory,
  sessionStartMemoryBlocks,
} from "../src/memory.js";
import { composePrompt } from "../src/composePrompt.js";
import { createMemoryStore } from "../src/memoryStore.js";

test("save and list memories", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-"));
  saveMemory(dir, "project", "# Project\nWe track XSS in TParser.");
  const all = listMemories(dir);
  assert.equal(all.length, 1);
  assert.equal(all[0]!.name, "project");
  assert.match(readMemory(dir, "project"), /TParser/);
  assert.ok(deleteMemory(dir, "project"));
});

test("resolveMemoryRoot follows CSAGENT_HOME", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-home-"));
  const home = mkdtempSync(resolve(tmpdir(), "csagent-home-"));
  const prev = process.env.CSAGENT_HOME;
  process.env.CSAGENT_HOME = home;
  try {
    assert.equal(resolveMemoryRoot(dir), resolve(home, ".agent"));
    assert.equal(memoryDir(dir), resolve(home, ".agent", "memory"));
  } finally {
    if (prev === undefined) delete process.env.CSAGENT_HOME;
    else process.env.CSAGENT_HOME = prev;
  }
});

test("expandMemoryRefs injects named memory", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-exp-"));
  saveMemory(dir, "stack", "# Stack\nKafka + SQLite");
  const out = await expandMemoryRefs("Summarize @memory:stack", dir);
  assert.match(out, /Kafka \+ SQLite/);
  assert.match(out, /# Task/);
  assert.match(out, /Summarize/);
  assert.doesNotMatch(out, /@memory:/);
});

test("expandMemoryRefs prefers DB note over stale file", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-db-"));
  saveMemory(dir, "note", "file-body");
  const store = createMemoryStore(dir);
  try {
    await store.upsertNote({ name: "note", body: "db-body" });
  } finally {
    await store.close();
  }
  const out = await expandMemoryRefs("@memory:note go", dir);
  assert.match(out, /db-body/);
  assert.doesNotMatch(out, /file-body/);
});

test("expandMemoryRefs all memories", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-all-"));
  saveMemory(dir, "a", "alpha");
  saveMemory(dir, "b", "beta");
  const out = await expandMemoryRefs("go @memory:", dir);
  assert.match(out, /alpha/);
  assert.match(out, /beta/);
});

test("missing memory throws MemoryError", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-miss-"));
  await assert.rejects(() => expandMemoryRefs("@memory:nope", dir), MemoryError);
});

test("composePrompt chains memory before file refs", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-compose-"));
  saveMemory(dir, "note", "remember this");
  const out = await composePrompt({ userPrompt: "@memory:note hello", cwd: dir, dir });
  assert.match(out, /remember this/);
  assert.match(out, /hello/);
});

test("redacts secrets on save", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-red-"));
  saveMemory(dir, "x", "CURSOR_API_KEY=secret123");
  assert.match(readMemory(dir, "x"), /<redacted>/);
});

test("listMemoryRefs dedupes", () => {
  assert.deepEqual(listMemoryRefs("@memory:a @memory:a").map((t) => t.name), ["a"]);
});

test("expandMemoryRefs prepends session-start blocks", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-pre-"));
  saveMemory(dir, "ops", "launchd gateway");
  const out = await expandMemoryRefs("hello", dir, ["### Memory: ops\n\nlaunchd gateway"]);
  assert.match(out, /loaded for this session/);
  assert.match(out, /launchd gateway/);
  assert.match(out, /hello/);
});

test("sessionStartMemoryBlocks loads configured notes", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-start-"));
  saveMemory(dir, "a", "note-a");
  saveMemory(dir, "b", "note-b");
  const cfg = loadConfig(dir);
  cfg.memory.onStart = ["a"];
  const blocks = await sessionStartMemoryBlocks(dir, cfg);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0]!, /note-a/);
});
