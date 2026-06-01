import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadCsagentEnv, parseEnvFile } from "../src/loadEnv.js";

test("parseEnvFile handles export and quotes", () => {
  const parsed = parseEnvFile(`
# comment
export CSAGENT_HOME="/tmp/home"
CSAGENT_DATABASE_URL='postgresql://x'
`);
  assert.equal(parsed.CSAGENT_HOME, "/tmp/home");
  assert.equal(parsed.CSAGENT_DATABASE_URL, "postgresql://x");
});

test("loadCsagentEnv does not override existing env", () => {
  const dir = mkdtempSync(join(tmpdir(), "csagent-env-"));
  writeFileSync(
    join(dir, ".env"),
    'CSAGENT_HOME="/from-file"\nOTHER_FROM_FILE=1\n',
    "utf8"
  );
  const prevHome = process.env.CSAGENT_HOME;
  process.env.CSAGENT_HOME = "/already-set";
  try {
    const loaded = loadCsagentEnv(dir);
    assert.ok(loaded.some((p) => p.endsWith(".env")));
    assert.equal(process.env.CSAGENT_HOME, "/already-set");
    assert.equal(process.env.OTHER_FROM_FILE, "1");
  } finally {
    delete process.env.OTHER_FROM_FILE;
    if (prevHome === undefined) delete process.env.CSAGENT_HOME;
    else process.env.CSAGENT_HOME = prevHome;
  }
});
