import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  clearPgAllowlistCache,
  migrateGatewayAllowlistToPg,
  resolveAllowedChatIds,
  setPgAllowlistCache,
  warmGatewayAllowlistCache,
} from "../src/gatewayAllowlist.js";
import {
  addPgAllowedChatId,
  closePgGatewayAllowlistPool,
  loadPgAllowedChatIds,
  pgGatewayAllowlistEnabled,
  removePgAllowedChatId,
} from "../src/gatewayAllowedPg.js";
import { loadGatewayConfig } from "../src/gatewayConfig.js";
import { writeExampleGatewayConfig } from "./helpers/gatewayConfig.js";

const PG_URL = process.env.CSAGENT_DATABASE_URL?.trim();
const PG_KEY = process.env.CSAGENT_SECRETS_KEY?.trim();

function seedGateway(dir: string, allowed: string[]): void {
  writeExampleGatewayConfig(dir, { adapter: "telegram", allowedChatIds: allowed });
}

test("resolveAllowedChatIds uses file + pairing when postgres disabled", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "allow-file-"));
  seedGateway(dir, ["111"]);
  writeFileSync(
    resolve(dir, ".agent", "gateway.pairing.json"),
    JSON.stringify({ version: 1, approved: ["222"], pending: [] }) + "\n",
    "utf8"
  );
  const cfg = loadGatewayConfig(dir);
  const ids = resolveAllowedChatIds(cfg, dir);
  assert.deepEqual(ids.sort(), ["111", "222"]);
});

test(
  "postgres allowlist encrypts chat ids and migrates from gateway.json",
  { skip: !PG_URL || !PG_KEY ? "CSAGENT_DATABASE_URL + CSAGENT_SECRETS_KEY required" : false },
  async () => {
    const prevUrl = process.env.CSAGENT_DATABASE_URL;
    const prevKey = process.env.CSAGENT_SECRETS_KEY;
    process.env.CSAGENT_DATABASE_URL = PG_URL;
    process.env.CSAGENT_SECRETS_KEY = PG_KEY;
    clearPgAllowlistCache();
    try {
      assert.equal(pgGatewayAllowlistEnabled(), true);
      const dir = mkdtempSync(resolve(tmpdir(), "allow-pg-"));
      seedGateway(dir, ["900001", "900002"]);
      const migrated = await migrateGatewayAllowlistToPg(dir);
      assert.equal(migrated, 2);
      const cfg = loadGatewayConfig(dir);
      assert.equal(cfg.allowedChatIdsStorage, "pg");
      assert.deepEqual(cfg.allowedChatIds, []);
      const fromPg = await loadPgAllowedChatIds();
      assert.deepEqual(fromPg.sort(), ["900001", "900002"]);
      setPgAllowlistCache(fromPg);
      assert.deepEqual(resolveAllowedChatIds(cfg, dir).sort(), ["900001", "900002"]);
      await addPgAllowedChatId("900003", { source: "pairing" });
      await warmGatewayAllowlistCache(dir);
      assert.ok(resolveAllowedChatIds(loadGatewayConfig(dir), dir).includes("900003"));
      for (const id of ["900001", "900002", "900003"]) {
        await removePgAllowedChatId(id);
      }
    } finally {
      if (prevUrl === undefined) delete process.env.CSAGENT_DATABASE_URL;
      else process.env.CSAGENT_DATABASE_URL = prevUrl;
      if (prevKey === undefined) delete process.env.CSAGENT_SECRETS_KEY;
      else process.env.CSAGENT_SECRETS_KEY = prevKey;
      clearPgAllowlistCache();
      await closePgGatewayAllowlistPool();
    }
  }
);

test("writeExampleGatewayConfig writes under test dir not CSAGENT_HOME", () => {
  const home = mkdtempSync(resolve(tmpdir(), "allow-home-"));
  const dir = mkdtempSync(resolve(tmpdir(), "allow-test-"));
  writeFileSync(resolve(dir, "agent.config.json"), JSON.stringify({ stateDir: ".agent" }) + "\n", "utf8");
  const prev = process.env.CSAGENT_HOME;
  process.env.CSAGENT_HOME = home;
  try {
    writeExampleGatewayConfig(dir, { allowedChatIds: ["777"] });
    const cfg = loadGatewayConfig(dir);
    assert.deepEqual(cfg.allowedChatIds, ["777"]);
  } finally {
    if (prev === undefined) delete process.env.CSAGENT_HOME;
    else process.env.CSAGENT_HOME = prev;
  }
});

test("gateway writes refuse CSAGENT_HOME/.agent during tests (I-111 split-brain guard)", () => {
  const home = mkdtempSync(resolve(tmpdir(), "allow-prodguard-"));
  const prev = process.env.CSAGENT_HOME;
  const prevLifecycle = process.env.npm_lifecycle_event;
  process.env.CSAGENT_HOME = home;
  process.env.npm_lifecycle_event = "test"; // make isTestRun() deterministic regardless of runner
  try {
    // dir === home → target resolves to CSAGENT_HOME/.agent → must be blocked.
    assert.throws(() => writeExampleGatewayConfig(home, { allowedChatIds: ["1"] }), /refusing to write/);
    // Explicit override allows it.
    process.env.CSAGENT_ALLOW_PROD_STATE_WRITE = "1";
    assert.doesNotThrow(() => writeExampleGatewayConfig(home, { allowedChatIds: ["1"] }));
  } finally {
    delete process.env.CSAGENT_ALLOW_PROD_STATE_WRITE;
    if (prev === undefined) delete process.env.CSAGENT_HOME;
    else process.env.CSAGENT_HOME = prev;
    if (prevLifecycle === undefined) delete process.env.npm_lifecycle_event;
    else process.env.npm_lifecycle_event = prevLifecycle;
  }
});
