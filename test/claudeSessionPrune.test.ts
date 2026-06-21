import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneClaudeSessions, formatBytes } from "../src/claudeSessionPrune.js";

function setup(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "claude-prune-"));
  const proj = join(root, "-Users-x-Downloads-TParser");
  mkdirSync(proj, { recursive: true });
  const now = Date.now();
  const day = 86_400_000;
  const mk = (name: string, ageDays: number, bytes = 100) => {
    const p = join(proj, name);
    writeFileSync(p, "x".repeat(bytes));
    const t = (now - ageDays * day) / 1000;
    utimesSync(p, t, t);
  };
  mk("old1.jsonl", 30, 200); // stale
  mk("old2.jsonl", 20, 300); // stale
  mk("fresh.jsonl", 2, 100); // active — keep
  writeFileSync(join(proj, "notes.txt"), "ignore me"); // non-jsonl — keep
  // nested subagent transcript (deeper than one level) — must be reached
  mkdirSync(join(proj, "session-uuid", "subagents"), { recursive: true });
  const sub = join(proj, "session-uuid", "subagents", "agent-old.jsonl");
  writeFileSync(sub, "x".repeat(150));
  const t = (now - 25 * day) / 1000;
  utimesSync(sub, t, t);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("pruneClaudeSessions", () => {
  it("removes only stale (>maxAgeDays) jsonl transcripts, keeps fresh + non-jsonl", () => {
    const { root, cleanup } = setup();
    try {
      const proj = join(root, "-Users-x-Downloads-TParser");
      const r = pruneClaudeSessions({ root, maxAgeDays: 14 });
      assert.equal(r.scanned, 4); // 3 top-level + 1 nested jsonl (notes.txt ignored)
      assert.equal(r.pruned, 3); // old1 + old2 + nested agent-old
      assert.equal(r.bytesFreed, 650);
      assert.ok(!existsSync(join(proj, "old1.jsonl")));
      assert.ok(!existsSync(join(proj, "old2.jsonl")));
      assert.ok(!existsSync(join(proj, "session-uuid", "subagents", "agent-old.jsonl"))); // nested reached
      assert.ok(existsSync(join(proj, "fresh.jsonl"))); // active session survives
      assert.ok(existsSync(join(proj, "notes.txt")));
    } finally {
      cleanup();
    }
  });

  it("dryRun reports but deletes nothing", () => {
    const { root, cleanup } = setup();
    try {
      const proj = join(root, "-Users-x-Downloads-TParser");
      const r = pruneClaudeSessions({ root, maxAgeDays: 14, dryRun: true });
      assert.equal(r.pruned, 3);
      assert.ok(existsSync(join(proj, "old1.jsonl"))); // still there
    } finally {
      cleanup();
    }
  });

  it("is a safe no-op when the root is absent", () => {
    const r = pruneClaudeSessions({ root: join(tmpdir(), "claude-prune-does-not-exist-xyz"), maxAgeDays: 14 });
    assert.deepEqual({ scanned: r.scanned, pruned: r.pruned, bytesFreed: r.bytesFreed }, {
      scanned: 0,
      pruned: 0,
      bytesFreed: 0,
    });
  });

  it("formatBytes renders human-readable sizes", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.match(formatBytes(2048), /2\.0 KiB/);
    assert.match(formatBytes(5 * 1024 * 1024), /5\.0 MiB/);
  });
});
