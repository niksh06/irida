import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandContextRefs, ContextRefError } from "../src/contextRefs.js";

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "ctx-"));
  writeFileSync(join(dir, "hello.txt"), "hello world");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "a.ts"), "export {}");
  return dir;
}

test("expandContextRefs leaves plain prompts unchanged", () => {
  assert.equal(expandContextRefs("summarize repo", "/tmp"), "summarize repo");
});

test("@file injects content", () => {
  const dir = workspace();
  const out = expandContextRefs("explain @file:hello.txt", dir);
  assert.match(out, /hello world/);
  assert.match(out, /# Task/);
  assert.match(out, /explain/);
});

test("@dir lists entries", () => {
  const dir = workspace();
  const out = expandContextRefs("list @dir:sub", dir);
  assert.match(out, /a\.ts/);
  assert.match(out, /dir/);
});

test("missing file throws ContextRefError", () => {
  const dir = workspace();
  assert.throws(() => expandContextRefs("@file:nope.txt task", dir), ContextRefError);
});

test("path traversal blocked", () => {
  const dir = workspace();
  assert.throws(() => expandContextRefs("@file:../outside", dir), /escapes workspace/);
});

test("large file truncated", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctx-big-"));
  writeFileSync(join(dir, "big.txt"), "x".repeat(70 * 1024));
  const out = expandContextRefs("@file:big.txt go", dir);
  assert.match(out, /truncated/);
});
