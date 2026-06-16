import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMemorySearchWingFlags } from "../src/memory_cmd.js";

test("parseMemorySearchWingFlags collects --wing values", () => {
  const { wings, rest } = parseMemorySearchWingFlags([
    "gateway",
    "cron",
    "--wing",
    "default,cursor-lesson",
    "--semantic",
  ]);
  assert.deepEqual(wings, ["default", "cursor-lesson"]);
  assert.deepEqual(rest, ["gateway", "cron", "--semantic"]);
});

test("parseMemorySearchWingFlags supports --wing=name", () => {
  const { wings, rest } = parseMemorySearchWingFlags(["q", "--wing=meta"]);
  assert.deepEqual(wings, ["meta"]);
  assert.deepEqual(rest, ["q"]);
});
