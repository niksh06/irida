import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("store updateSessionTitle", () => {
  it("updates title", () => {
    const dir = mkdtempSync(join(tmpdir(), "csagent-store-"));
    const store = new Store(dir, ".agent");
    store.upsertSession({
      id: "sess-1",
      title: "old",
      cwd: dir,
      runtime: "local",
      last_status: "ok",
    });
    assert.equal(store.updateSessionTitle("sess-1", "new title"), true);
    assert.equal(store.getSession("sess-1")?.title, "new title");
    store.close();
  });
});
