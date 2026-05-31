import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SqliteStore } from "../src/store.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("store updateSessionTitle", () => {
  it("updates title", async () => {
    const dir = mkdtempSync(join(tmpdir(), "csagent-store-"));
    const store = new SqliteStore(dir, ".agent");
    await store.upsertSession({
      id: "sess-1",
      title: "old",
      cwd: dir,
      runtime: "local",
      last_status: "ok",
    });
    assert.equal(await store.updateSessionTitle("sess-1", "new title"), true);
    assert.equal((await store.getSession("sess-1"))?.title, "new title");
    await store.close();
  });
});
