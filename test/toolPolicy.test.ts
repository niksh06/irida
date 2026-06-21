import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { destructiveReason } from "../src/safety.js";
import { evaluateToolInput } from "../src/engines/claudeAgentSdk.js";
import { resolveDenyDestructive, type EngineConfig } from "../src/config.js";

describe("destructiveReason (shared denylist)", () => {
  it("flags destructive shell shapes with the matched text", () => {
    assert.equal(destructiveReason("rm -rf /tmp/x"), "rm -rf");
    assert.match(destructiveReason("psql -c 'DROP TABLE users'") ?? "", /drop table/i);
    assert.ok(destructiveReason("git push origin main --force"));
  });
  it("returns null for benign text", () => {
    assert.equal(destructiveReason("ls -la && cat README.md"), null);
    assert.equal(destructiveReason("git status"), null);
  });
});

describe("evaluateToolInput (claude-agent canUseTool gate)", () => {
  it("denies a destructive Bash command and names the hit", () => {
    const d = evaluateToolInput({ command: "rm -rf /tmp/irida-test" });
    assert.equal(d.behavior, "deny");
    if (d.behavior === "deny") assert.match(d.message, /rm -rf/);
  });
  it("scans every string field, not just `command`", () => {
    const d = evaluateToolInput({ description: "cleanup", script: "mkfs.ext4 /dev/sda" });
    assert.equal(d.behavior, "deny");
  });
  it("allows benign tool inputs", () => {
    assert.equal(evaluateToolInput({ command: "ls -la" }).behavior, "allow");
    assert.equal(evaluateToolInput({ file_path: "/repo/src/index.ts" }).behavior, "allow");
  });
  it("allow branch echoes updatedInput (SDK Zod requires a record, not undefined)", () => {
    const input = { command: "ls -la", timeout: 1000 };
    const d = evaluateToolInput(input);
    assert.equal(d.behavior, "allow");
    if (d.behavior === "allow") assert.deepEqual(d.updatedInput, input);
  });
  it("ignores non-string fields", () => {
    assert.equal(evaluateToolInput({ timeout: 1000, recursive: true }).behavior, "allow");
  });
});

describe("resolveDenyDestructive (per-surface policy)", () => {
  const base: EngineConfig = { provider: "claude-agent", auth: "account" };

  it("defaults to false when no policy is set (no behavior change)", () => {
    assert.equal(resolveDenyDestructive(base), false);
    assert.equal(resolveDenyDestructive(base, "telegram"), false);
  });
  it("honors a top-level denyDestructive", () => {
    const e: EngineConfig = { ...base, toolPolicy: { denyDestructive: true } };
    assert.equal(resolveDenyDestructive(e, "tui"), true);
    assert.equal(resolveDenyDestructive(e), true);
  });
  it("lets a per-surface entry win over the top-level default", () => {
    const e: EngineConfig = {
      ...base,
      toolPolicy: { denyDestructive: false, bySurface: { telegram: true, cron: true, tui: false } },
    };
    assert.equal(resolveDenyDestructive(e, "telegram"), true); // strict autonomous surface
    assert.equal(resolveDenyDestructive(e, "cron"), true);
    assert.equal(resolveDenyDestructive(e, "tui"), false); // relaxed interactive surface
    assert.equal(resolveDenyDestructive(e, "unknown"), false); // falls back to top-level
  });
});
