import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  setLastSeen,
  getLastSeen,
  loadLastSeen,
  HOMEBASE_LASTSEEN_FILE,
  type LastSeenEntry,
} from "../src/homebaseStore.js";

function sandbox(): { dir: string; stateDir: string } {
  const dir = mkdtempSync(resolve(tmpdir(), "hb-store-"));
  mkdirSync(resolve(dir, ".agent"), { recursive: true });
  return { dir, stateDir: ".agent" };
}

test("setLastSeen/getLastSeen round-trip for a single repo::agent key", async () => {
  const { dir, stateDir } = sandbox();
  const entry: LastSeenEntry = { lastSeenSha: "abc123", lastVisitAtMs: 1000, openThreads: ["t1"] };
  await setLastSeen(dir, stateDir, "/repo/a", "irida", entry);
  assert.deepEqual(getLastSeen(dir, stateDir, "/repo/a", "irida"), entry);
});

test("composite-key isolation — different repoPaths/agentIds don't clobber each other", async () => {
  const { dir, stateDir } = sandbox();
  const e1: LastSeenEntry = { lastSeenSha: "s1", lastVisitAtMs: 1, openThreads: [] };
  const e2: LastSeenEntry = { lastSeenSha: "s2", lastVisitAtMs: 2, openThreads: [] };
  await setLastSeen(dir, stateDir, "/repo/a", "irida", e1);
  await setLastSeen(dir, stateDir, "/repo/b", "irida", e2);
  assert.deepEqual(getLastSeen(dir, stateDir, "/repo/a", "irida"), e1);
  assert.deepEqual(getLastSeen(dir, stateDir, "/repo/b", "irida"), e2);
  // same repo, different agent -> isolated
  assert.equal(getLastSeen(dir, stateDir, "/repo/a", "other-agent"), undefined);
});

test("corrupt JSON on disk is backed up and loadLastSeen falls back to empty without throwing", () => {
  const { dir, stateDir } = sandbox();
  const p = resolve(dir, stateDir, HOMEBASE_LASTSEEN_FILE);
  writeFileSync(p, "{not valid json");
  const file = loadLastSeen(dir, stateDir);
  assert.deepEqual(file.entries, {});
  const backups = readdirSync(resolve(dir, stateDir)).filter((f) => f.startsWith(`${HOMEBASE_LASTSEEN_FILE}.corrupt-`));
  assert.equal(backups.length, 1);
});

test("a malformed entry surviving JSON.parse is filtered out by validEntry", () => {
  const { dir, stateDir } = sandbox();
  const p = resolve(dir, stateDir, HOMEBASE_LASTSEEN_FILE);
  writeFileSync(p, JSON.stringify({ version: 1, entries: { "bad::key": { openThreads: [] } } }));
  const file = loadLastSeen(dir, stateDir);
  assert.deepEqual(file.entries, {});
});

test("two concurrent setLastSeen calls for different repos both persist (no lost update)", async () => {
  const { dir, stateDir } = sandbox();
  const e1: LastSeenEntry = { lastSeenSha: "s1", lastVisitAtMs: 1, openThreads: [] };
  const e2: LastSeenEntry = { lastSeenSha: "s2", lastVisitAtMs: 2, openThreads: [] };
  await Promise.all([
    setLastSeen(dir, stateDir, "/repo/a", "irida", e1),
    setLastSeen(dir, stateDir, "/repo/b", "irida", e2),
  ]);
  assert.deepEqual(getLastSeen(dir, stateDir, "/repo/a", "irida"), e1);
  assert.deepEqual(getLastSeen(dir, stateDir, "/repo/b", "irida"), e2);
});
