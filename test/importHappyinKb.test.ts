import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importHappyinKb, makeNoteName } from "../src/importHappyinKb.js";

test("makeNoteName keeps domain.slug under 64 chars", () => {
  const short = makeNoteName("kafka", "consumer-groups");
  assert.equal(short, "kafka.consumer-groups");
  assert.ok(short.length <= 64);

  const longSlug = "spatialedit-16b-geometric-control-for-diffusion-based-image-editing";
  const long = makeNoteName("image-generation", longSlug);
  assert.ok(long.length <= 64);
  assert.ok(long.startsWith("image-generation."));
  assert.notEqual(long, `image-generation.${longSlug}`);
});

test("makeNoteName sanitizes invalid slug characters", () => {
  assert.equal(makeNoteName("image-generation", "ACE++"), "image-generation.ACE");
});

test("importHappyinKb domains filter limits imported notes", async () => {
  const kbRoot = mkdtempSync(join(tmpdir(), "kb-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "mem-"));
  mkdirSync(join(kbRoot, "kafka"), { recursive: true });
  mkdirSync(join(kbRoot, "python"), { recursive: true });
  writeFileSync(join(kbRoot, "kafka", "a.md"), "# A\n", "utf8");
  writeFileSync(join(kbRoot, "python", "b.md"), "# B\n", "utf8");
  writeFileSync(join(kbRoot, ".kb-sync"), "abc123\n", "utf8");

  const result = await importHappyinKb({ kbRoot, memoryDir, domains: ["kafka"], dryRun: true });
  assert.equal(result.imported, 1);
});
