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
  assert.equal(c.engine.provider, "cursor");
});

test("engine: selects claude-agent with optional model override", () => {
  const dir = tmp();
  writeFileSync(
    resolve(dir, "agent.config.json"),
    JSON.stringify({ engine: { provider: "claude-agent", model: "claude-opus-4-8" } })
  );
  const c = loadConfig(dir);
  assert.equal(c.engine.provider, "claude-agent");
  assert.equal(c.engine.model, "claude-opus-4-8");
});

test("engine: provider defaults to cursor when only model given", () => {
  const dir = tmp();
  writeFileSync(resolve(dir, "agent.config.json"), JSON.stringify({ engine: { model: "x" } }));
  assert.equal(loadConfig(dir).engine.provider, "cursor");
});

test("engine: rejects unknown provider", () => {
  const dir = tmp();
  writeFileSync(resolve(dir, "agent.config.json"), JSON.stringify({ engine: { provider: "gpt" } }));
  assert.throws(() => loadConfig(dir), ConfigError);
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

function write(dir: string, cfg: unknown): void {
  writeFileSync(resolve(dir, "agent.config.json"), JSON.stringify(cfg));
}

test("safety is lenient — non-true coerces to false (no throw)", () => {
  const dir = tmp();
  write(dir, { safety: { allowCloud: "yes", allowAutoPr: 1 } });
  const c = loadConfig(dir);
  assert.equal(c.safety.allowCloud, false);
  assert.equal(c.safety.allowAutoPr, false);
});

test("string arrays are trimmed and empties dropped", () => {
  const dir = tmp();
  write(dir, { memory: { onStart: ["  a ", "", "  ", "b"] } });
  assert.deepEqual(loadConfig(dir).memory.onStart, ["a", "b"]);
});

test("nested strings are stored trimmed", () => {
  const dir = tmp();
  write(dir, { memory: { embeddings: { url: "  http://x  " } } });
  assert.equal(loadConfig(dir).memory.embeddings?.url, "http://x");
});

test("rejects numeric minimums", () => {
  for (const cfg of [
    { memory: { maxCharsPerTurn: 10 } },
    { memory: { autoRag: { limit: 0 } } },
    { memory: { search: { hybridWeights: { fts: 0 } } } },
    { hooks: { preTurn: { command: "x", timeoutMs: 50 } } },
  ]) {
    const dir = tmp();
    write(dir, cfg);
    assert.throws(() => loadConfig(dir), ConfigError, JSON.stringify(cfg));
  }
});

test("rejects a nested object given as an array", () => {
  const dir = tmp();
  write(dir, { memory: [] });
  assert.throws(() => loadConfig(dir), ConfigError);
});

test("skillPolicy only materializes when allowUnsafe is present", () => {
  const a = tmp();
  write(a, { skillPolicy: {} });
  assert.equal(loadConfig(a).skillPolicy, undefined);

  const b = tmp();
  write(b, { skillPolicy: { allowUnsafe: [" s ", ""] } });
  assert.deepEqual(loadConfig(b).skillPolicy, { allowUnsafe: ["s"] });
});
