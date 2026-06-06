import { test } from "node:test";
import assert from "node:assert/strict";
import { searchSessions } from "../src/sessionSearch.js";
import type { IStore, SessionRecord } from "../src/store.js";

class FakeStore implements IStore {
  constructor(private rows: SessionRecord[]) {}
  async listSessions(limit = 200): Promise<SessionRecord[]> {
    return this.rows.slice(0, limit);
  }
  async close(): Promise<void> {}
  // stubs — not used by searchSessions
  async upsertSession(): Promise<void> {}
  async getSession(): Promise<SessionRecord | null> {
    return null;
  }
  async listRuns(): Promise<never[]> {
    return [];
  }
  async recordRun(): Promise<void> {}
}

test("searchSessions filters by title and id", async () => {
  const store = new FakeStore([
    { id: "sess_aaa", title: "TParser digest", cwd: "/a", runtime: "local", updated_at: "", last_status: "ok" },
    { id: "sess_bbb", title: "Other", cwd: "/b", runtime: "local", updated_at: "", last_status: "ok" },
  ]);
  const hits = await searchSessions(store, "tparser");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.id, "sess_aaa");
  await store.close();
});
