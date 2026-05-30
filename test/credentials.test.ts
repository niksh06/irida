import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  resolveApiKey,
  saveCredentials,
  clearCredentials,
  credentialsPath,
  CREDENTIALS_FILE,
} from "../src/credentials.js";
import { cmdAuth } from "../src/auth_cmd.js";
import { cmdRun } from "../src/run.js";
import type { SdkLike } from "../src/host.js";

function withKey(value: string | undefined, fn: () => void | Promise<void>): Promise<void> {
  const prev = process.env.CURSOR_API_KEY;
  if (value === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = value;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prev;
  });
}

test("resolveApiKey prefers environment over file", async () => {
  await withKey(undefined, () => {
    const dir = mkdtempSync(resolve(tmpdir(), "cred-"));
    saveCredentials("file-key", dir);
    assert.deepEqual(resolveApiKey(dir), { key: "file-key", source: "file" });
  });
  await withKey("env-key", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "cred-env-"));
    saveCredentials("file-key", dir);
    assert.deepEqual(resolveApiKey(dir), { key: "env-key", source: "env" });
  });
});

test("saveCredentials writes mode 600 json", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cred-mode-"));
  saveCredentials("cursor_test_secret", dir);
  const path = credentialsPath(dir);
  assert.ok(existsSync(path));
  const mode = statSync(path).mode & 0o777;
  assert.equal(mode, 0o600);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { cursor_api_key?: string };
  assert.equal(parsed.cursor_api_key, "cursor_test_secret");
  assert.ok(path.endsWith(CREDENTIALS_FILE));
});

test("clearCredentials removes file", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cred-clear-"));
  saveCredentials("k", dir);
  assert.ok(clearCredentials(dir));
  assert.equal(resolveApiKey(dir).source, "none");
  assert.equal(clearCredentials(dir), false);
});

test("cmdRun works with file-stored key", async () => {
  await withKey(undefined, async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "cred-run-"));
    saveCredentials("stored-key", dir);
    const sdk: SdkLike = {
      prompt: async (_msg, opts) => {
        assert.equal(opts.apiKey, "stored-key");
        return { status: "finished", result: "ok", id: "r1", agentId: "a1" };
      },
    };
    assert.equal(await cmdRun("hi", { sdk, dir }), 0);
  });
});

test("auth login --from-env copies to file", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "cred-auth-"));
  await withKey("copy-me", async () => {
    assert.equal(await cmdAuth(["login", "--from-env"], dir), 0);
  });
  await withKey(undefined, () => {
    assert.deepEqual(resolveApiKey(dir), { key: "copy-me", source: "file" });
  });
});

test("auth status does not print key", async () => {
  await withKey(undefined, async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "cred-st-"));
    saveCredentials("super-secret-key", dir);
    const lines: string[] = [];
    const orig = console.log;
    console.log = (s: string) => lines.push(s);
    try {
      assert.equal(await cmdAuth(["status"], dir), 0);
    } finally {
      console.log = orig;
    }
    const out = lines.join("\n");
    assert.match(out, /configured/);
    assert.doesNotMatch(out, /super-secret-key/);
  });
});
