import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadConfig, ConfigError } from "../src/config.js";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "cfg-"));
}

test("defaults when no config file", () => {
  const dir = tmp();
  const c = loadConfig(dir);
  assert.equal(c.model, "composer-2.5");
  assert.equal(c.runtime, "local");
  assert.equal(c.cwd, dir);
  assert.equal(c.safety.allowCloud, false);
});

test("rejects secrets in config", () => {
  const dir = tmp();
  writeFileSync(resolve(dir, "agent.config.json"), JSON.stringify({ CURSOR_API_KEY: "x" }));
  assert.throws(() => loadConfig(dir), ConfigError);
});

test("rejects invalid JSON", () => {
  const dir = tmp();
  writeFileSync(resolve(dir, "agent.config.json"), "{ not json");
  assert.throws(() => loadConfig(dir), ConfigError);
});

test("rejects bad runtime", () => {
  const dir = tmp();
  writeFileSync(resolve(dir, "agent.config.json"), JSON.stringify({ runtime: "moon" }));
  assert.throws(() => loadConfig(dir), ConfigError);
});

test("accepts valid overrides", () => {
  const dir = tmp();
  writeFileSync(
    resolve(dir, "agent.config.json"),
    JSON.stringify({ model: "composer-2", runtime: "cloud", safety: { allowCloud: true } })
  );
  const c = loadConfig(dir);
  assert.equal(c.model, "composer-2");
  assert.equal(c.runtime, "cloud");
  assert.equal(c.safety.allowCloud, true);
});
