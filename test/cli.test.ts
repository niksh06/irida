import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { redact } from "../src/redact.js";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("CLI --help exits 0 and names itself", async () => {
  const { stdout } = await exec("npx", ["tsx", "src/cli.ts", "--help"], { cwd: root });
  assert.match(stdout, /csagent/);
});

test("CLI unknown command exits non-zero", async () => {
  await assert.rejects(
    exec("npx", ["tsx", "src/cli.ts", "bogus"], { cwd: root }),
    (err: unknown) => (err as { code?: number }).code !== 0
  );
});

test("redact masks key-shaped secrets", () => {
  assert.match(redact("CURSOR_API_KEY=key_abcdef123456"), /<redacted>/);
  assert.doesNotMatch(redact("CURSOR_API_KEY=key_abcdef123456"), /abcdef123456/);
});

test("redact masks DB connection-string passwords and secret assignments", () => {
  const dsn = redact("connect postgres://csagent:Sup3rSecretPw@db.host:5432/csagent failed");
  assert.doesNotMatch(dsn, /Sup3rSecretPw/);
  assert.match(dsn, /postgres:\/\/csagent:<redacted>@db\.host/);
  assert.doesNotMatch(redact('{"password": "hunter2tunafish"}'), /hunter2tunafish/);
});
