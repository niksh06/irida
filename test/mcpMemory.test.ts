import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { MEMORY_MCP_NAME, resolveMcpServers } from "../src/mcpServers.js";
import {
  handleMemoryFactInvalidate,
  MEMORY_MCP_TOOL_NAMES,
} from "../src/mcp/memoryTools.js";
import { createMemoryStore } from "../src/memoryStore.js";

test("resolveMcpServers adds csagent-memory by default", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mcp-res-"));
  const cfg = loadConfig(dir);
  const merged = resolveMcpServers(cfg, dir);
  assert.ok(MEMORY_MCP_NAME in merged);
  const entry = merged[MEMORY_MCP_NAME] as { command?: string; env?: Record<string, string> };
  assert.ok(entry.command);
  assert.equal(entry.env?.CSAGENT_MEMORY_DIR, resolve(dir));
});

test("resolveMcpServers respects memory.mcp false", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mcp-off-"));
  writeFileSync(join(dir, "agent.config.json"), JSON.stringify({ memory: { mcp: false } }));
  const cfg = loadConfig(dir);
  assert.equal(MEMORY_MCP_NAME in resolveMcpServers(cfg, dir), false);
});

test("MEMORY_MCP_TOOL_NAMES includes memory_fact_invalidate", () => {
  assert.ok(MEMORY_MCP_TOOL_NAMES.includes("memory_fact_invalidate"));
});

test("handleMemoryFactInvalidate by id closes fact", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mcp-inv-id-"));
  const ctx = { dir, stateDir: ".agent" };
  const store = createMemoryStore(dir, ctx.stateDir);
  let factId = "";
  try {
    const fact = await store.addFact({
      subject: "pref",
      predicate: "likes",
      object: "kafka",
      source: "test",
    });
    factId = fact.id;
  } finally {
    await store.close();
  }

  const msg = await handleMemoryFactInvalidate(ctx, { fact_id: factId });
  assert.match(msg, /invalidated/);

  const store2 = createMemoryStore(dir, ctx.stateDir);
  try {
    const current = await store2.queryFacts({ subject: "pref", currentOnly: true });
    assert.equal(current.length, 0);
    const all = await store2.queryFacts({ subject: "pref", currentOnly: false });
    assert.equal(all.length, 1);
    assert.ok(all[0]!.valid_to);
  } finally {
    await store2.close();
  }
});

test("handleMemoryFactInvalidate by scope matches predicate and object", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mcp-inv-scope-"));
  const ctx = { dir, stateDir: ".agent" };
  const store = createMemoryStore(dir, ctx.stateDir);
  try {
    await store.addFact({
      subject: "seen_post",
      predicate: "ch1",
      object: "p1",
      source: "test",
    });
    await store.addFact({
      subject: "seen_post",
      predicate: "ch1",
      object: "p2",
      source: "test",
    });
    await store.addFact({
      subject: "seen_post",
      predicate: "ch2",
      object: "p1",
      source: "test",
    });
  } finally {
    await store.close();
  }

  const msg = await handleMemoryFactInvalidate(ctx, {
    subject: "seen_post",
    predicate: "ch1",
    object: "p1",
  });
  assert.match(msg, /invalidated 1 fact/);

  const store2 = createMemoryStore(dir, ctx.stateDir);
  try {
    const current = await store2.queryFacts({ subject: "seen_post", currentOnly: true });
    assert.equal(current.length, 2);
    assert.ok(current.every((f) => f.object !== "p1" || f.predicate !== "ch1"));
  } finally {
    await store2.close();
  }
});

test("memory store readable via MCP context paths", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "mcp-tool-"));
  const store = createMemoryStore(dir, ".agent");
  try {
    await store.upsertNote({ name: "ops", body: "# Ops\nlaunchd gateway" });
    const note = await store.getNote("ops");
    assert.match(note?.body ?? "", /launchd gateway/);
  } finally {
    await store.close();
  }
});
