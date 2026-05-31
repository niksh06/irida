import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import {
  deleteMemory,
  expandMemoryRefs,
  listMemories,
  listMemoryRefs,
  MemoryError,
  readMemory,
  saveMemory,
  sessionStartMemoryBlocks,
} from "../src/memory.js";
import { composePrompt } from "../src/composePrompt.js";

test("save and list memories", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-"));
  saveMemory(dir, "project", "# Project\nWe track XSS in TParser.");
  const all = listMemories(dir);
  assert.equal(all.length, 1);
  assert.equal(all[0]!.name, "project");
  assert.match(readMemory(dir, "project"), /TParser/);
  assert.ok(deleteMemory(dir, "project"));
});

test("expandMemoryRefs injects named memory", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-exp-"));
  saveMemory(dir, "stack", "# Stack\nKafka + SQLite");
  const out = expandMemoryRefs("Summarize @memory:stack", dir);
  assert.match(out, /Kafka \+ SQLite/);
  assert.match(out, /# Task/);
  assert.match(out, /Summarize/);
  assert.doesNotMatch(out, /@memory:/);
});

test("expandMemoryRefs all memories", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-all-"));
  saveMemory(dir, "a", "alpha");
  saveMemory(dir, "b", "beta");
  const out = expandMemoryRefs("go @memory:", dir);
  assert.match(out, /alpha/);
  assert.match(out, /beta/);
});

test("missing memory throws MemoryError", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-miss-"));
  assert.throws(() => expandMemoryRefs("@memory:nope", dir), MemoryError);
});

test("composePrompt chains memory before file refs", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-compose-"));
  saveMemory(dir, "note", "remember this");
  const out = composePrompt({ userPrompt: "@memory:note hello", cwd: dir, dir });
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

test("expandMemoryRefs prepends session-start blocks", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-pre-"));
  saveMemory(dir, "ops", "launchd gateway");
  const out = expandMemoryRefs("hello", dir, ["### Memory: ops\n\nlaunchd gateway"]);
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
