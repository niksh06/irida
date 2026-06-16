import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore } from "../src/memoryStore.js";
import {
  planDefaultCorpusReWing,
  resolveDefaultCorpusWing,
  runDefaultCorpusReWing,
} from "../src/memoryReWing.js";
import { REDDIT_WING, STYLE_WING, TPARSER_WING } from "../src/memoryWings.js";

test("resolveDefaultCorpusWing maps known default notes", () => {
  assert.equal(resolveDefaultCorpusWing("tparser-workflow"), TPARSER_WING);
  assert.equal(resolveDefaultCorpusWing("reddit-feeds"), REDDIT_WING);
  assert.equal(resolveDefaultCorpusWing("infosec-post-style"), STYLE_WING);
  assert.equal(resolveDefaultCorpusWing("mlsecai-post-style"), STYLE_WING);
  assert.equal(resolveDefaultCorpusWing("reddit-digest-2026-06-16"), REDDIT_WING);
  assert.equal(resolveDefaultCorpusWing("ops-gateway"), null);
  assert.equal(resolveDefaultCorpusWing("csagent-index"), null);
});

test("runDefaultCorpusReWing dry-run then apply", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rewing-"));
  const store = createMemoryStore(dir, ".agent");
  try {
    await store.upsertNote({ name: "tparser-workflow", body: "# TParser", wing: "default" });
    await store.upsertNote({ name: "ops-gateway", body: "# Ops", wing: "default" });
    await store.upsertNote({ name: "ai-ml-post-style", body: "# Style", wing: "default" });

    const dry = await runDefaultCorpusReWing(store, {});
    assert.equal(dry.planned, 2);
    assert.equal(dry.applied, 0);
    assert.deepEqual(
      planDefaultCorpusReWing(await store.listNotes("default")).map((m) => m.name),
      ["ai-ml-post-style", "tparser-workflow"]
    );

    const applied = await runDefaultCorpusReWing(store, { apply: true });
    assert.equal(applied.applied, 2);
    const tparser = await store.getNote("tparser-workflow");
    const style = await store.getNote("ai-ml-post-style");
    const ops = await store.getNote("ops-gateway");
    assert.equal(tparser?.wing, TPARSER_WING);
    assert.equal(style?.wing, STYLE_WING);
    assert.equal(ops?.wing, "default");
  } finally {
    await store.close();
  }
});
