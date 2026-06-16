import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DEFAULT_STALE_DAYS,
  evaluateMemoryAudit,
  extractUrls,
  formatMemoryAuditReport,
  isOpsNote,
  OPS_NOTE_NAMES,
} from "../src/memoryAudit.js";
import { createMemoryStore } from "../src/memoryStore.js";
import { saveMemory } from "../src/memory.js";

function setupDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "mem-audit-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ stateDir: ".agent", cwd: dir }),
    "utf8"
  );
  return dir;
}

test("extractUrls finds http and t.me links", () => {
  const urls = extractUrls("See https://example.com/path and t.me/c/123/456 for info.");
  assert.ok(urls.some((u) => u.includes("example.com")));
  assert.ok(urls.some((u) => u.includes("t.me")));
});

test("isOpsNote recognizes ops names and default wing", () => {
  assert.equal(isOpsNote({ name: "tparser-workflow", wing: "kafka", body: "", title: "", created_at: "", updated_at: "" }), true);
  assert.equal(isOpsNote({ name: "kafka.foo", wing: "default", body: "", title: "", created_at: "", updated_at: "" }), true);
  assert.equal(isOpsNote({ name: "kafka.foo", wing: "kafka", body: "", title: "", created_at: "", updated_at: "" }), false);
  assert.ok(OPS_NOTE_NAMES.has("csagent-index"));
});

test("evaluateMemoryAudit passes for minimal ops note store", async () => {
  const dir = setupDir();
  const body = "# Index\n\nOps note with https://example.com/link for audit.";
  saveMemory(dir, "csagent-index", body);
  const store = createMemoryStore(dir);
  try {
    await store.upsertNote({ name: "csagent-index", body, wing: "default" });
    await store.addFact({ subject: "seen_post", predicate: "seen", object: "post:1", source: "test" });
  } finally {
    await store.close();
  }

  const report = await evaluateMemoryAudit({ dir, staleDays: DEFAULT_STALE_DAYS, checkLinks: false });
  assert.equal(report.ok, true);
  assert.ok(report.checks.some((c) => c.name === "notes count" && c.ok));
  assert.ok(report.checks.some((c) => c.name === "seen_post legacy" && c.severity === "warn"));
  const text = formatMemoryAuditReport(report);
  assert.match(text, /memory audit · PASS/);
});

test("factAuditSummary counts current and invalidated", async () => {
  const dir = setupDir();
  const store = createMemoryStore(dir);
  try {
    const f1 = await store.addFact({ subject: "seen_post", predicate: "seen", object: "a", source: "t" });
    await store.addFact({ subject: "seen_post", predicate: "seen", object: "b", source: "t" });
    await store.invalidateFact(f1.id);
    const stats = await store.factAuditSummary();
    assert.equal(stats.currentTotal, 1);
    assert.equal(stats.invalidatedTotal, 1);
    assert.equal(stats.subjects[0]!.subject, "seen_post");
  } finally {
    await store.close();
  }
});
