import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cmdSessions } from "../src/sessions_cmd.js";
import { Store } from "../src/store.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "sess-"));
}

test("empty store -> exit 0", () => {
  assert.equal(cmdSessions(tmp()), 0);
});

test("lists a stored session -> exit 0", () => {
  const dir = tmp();
  const s = new Store(dir, ".agent");
  s.upsertSession({ id: "sess_z", title: "demo", cwd: dir, runtime: "local", last_status: "finished" });
  s.close();
  assert.equal(cmdSessions(dir), 0);
});
