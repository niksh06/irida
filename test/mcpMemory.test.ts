import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { MEMORY_MCP_NAME, resolveMcpServers } from "../src/mcpServers.js";
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
