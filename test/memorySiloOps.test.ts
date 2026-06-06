import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { alignMemorySilos, siloIsAligned } from "../src/memorySiloOps.js";

test("alignMemorySilos copies notes to canonical", () => {
  const home = mkdtempSync(resolve(tmpdir(), "silo-home-"));
  const repo = mkdtempSync(resolve(tmpdir(), "silo-repo-"));
  const prevHome = process.env.CSAGENT_HOME;
  process.env.CSAGENT_HOME = home;
  try {
    const canonicalMem = resolve(home, ".agent", "memory");
    const repoMem = resolve(repo, ".agent", "memory");
    mkdirSync(repoMem, { recursive: true });
    writeFileSync(resolve(repoMem, "note-a.md"), "# A\n", "utf8");

    const result = alignMemorySilos(repo, false);
    assert.equal(result.copied, 1);
    assert.ok(siloIsAligned(repoMem, canonicalMem));
  } finally {
    if (prevHome === undefined) delete process.env.CSAGENT_HOME;
    else process.env.CSAGENT_HOME = prevHome;
  }
});
