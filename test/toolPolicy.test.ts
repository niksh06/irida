import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { destructiveReason } from "../src/safety.js";
import {
  evaluateToolInput,
  interceptInteractiveAsk,
  ASK_USER_STEER_MESSAGE,
} from "../src/engines/claudeAgentSdk.js";
import { resolveDenyDestructive, type EngineConfig } from "../src/config.js";

describe("destructiveReason (shared denylist)", () => {
  it("flags destructive shell shapes with the matched text", () => {
    assert.equal(destructiveReason("rm -rf /tmp/x"), "rm -rf");
    assert.match(destructiveReason("psql -c 'DROP TABLE users'") ?? "", /drop table/i);
    assert.ok(destructiveReason("git push origin main --force"));
    assert.ok(destructiveReason("git push -f")); // S3: short force-push also denied
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

describe("interceptInteractiveAsk (I-125 headless ask steer)", () => {
  it("denies the built-in AskUserQuestion and steers to ask_user", () => {
    const d = interceptInteractiveAsk("AskUserQuestion");
    assert.ok(d);
    assert.equal(d!.behavior, "deny");
    if (d!.behavior === "deny") {
      assert.equal(d!.message, ASK_USER_STEER_MESSAGE);
      assert.match(d!.message, /ask_user/);
    }
  });
  it("returns null for any other tool (flows through the normal gate)", () => {
    assert.equal(interceptInteractiveAsk("Bash"), null);
    assert.equal(interceptInteractiveAsk("Edit"), null);
    assert.equal(interceptInteractiveAsk("ask_user"), null); // our MCP tool is allowed
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

import { sanitizeCommand } from "../src/engines/claudeAgentSdk.js";

describe("sanitizeCommand (I-117 input sanitizer)", () => {
  it("adds -i to a bare rm (no flags)", () => {
    assert.equal(sanitizeCommand("rm a && rm b").command, "rm -i a && rm -i b"); // S2: every rm in a compound
    assert.equal(sanitizeCommand(`git commit -m "rm temp"`).command, `git commit -m "rm temp"`); // S1: not in a quoted arg
    assert.equal(sanitizeCommand("grep rm foo").command, "grep rm foo"); // S1: not an argument
    const r = sanitizeCommand("rm notes.txt");
    assert.equal(r.command, "rm -i notes.txt");
    assert.equal(r.rewrites.length, 1);
  });
  it("leaves flagged rm untouched (too risky to parse; -rf is denied upstream)", () => {
    assert.equal(sanitizeCommand("rm -i notes.txt").rewrites.length, 0);
    assert.equal(sanitizeCommand("rm -f notes.txt").command, "rm -f notes.txt");
  });
  it("strips --no-verify", () => {
    const r = sanitizeCommand("git commit --no-verify -m 'x'");
    assert.equal(r.command, "git commit -m 'x'");
    assert.match(r.rewrites[0]!, /no-verify/);
  });
  it("no-ops a benign command", () => {
    assert.deepEqual(sanitizeCommand("ls -la && git status").rewrites, []);
  });
});

describe("evaluateToolInput sanitize path (I-117)", () => {
  it("rewrites a borderline command when sanitize is on, carrying the rewrite log", () => {
    const d = evaluateToolInput({ command: "git commit --no-verify -m x" }, { sanitize: true });
    assert.equal(d.behavior, "allow");
    if (d.behavior === "allow") {
      assert.equal(d.updatedInput.command, "git commit -m x");
      assert.ok(d.rewrites && d.rewrites.length === 1);
    }
  });
  it("allows verbatim (no rewrites) when sanitize is off — default", () => {
    const d = evaluateToolInput({ command: "rm notes.txt" });
    assert.equal(d.behavior, "allow");
    if (d.behavior === "allow") {
      assert.equal(d.updatedInput.command, "rm notes.txt");
      assert.equal(d.rewrites, undefined);
    }
  });
  it("deny still wins over sanitize for genuinely destructive input", () => {
    const d = evaluateToolInput({ command: "rm -rf /tmp/x" }, { sanitize: true });
    assert.equal(d.behavior, "deny");
  });
});

describe("denylist: --force-with-lease allowed, --force denied (I-117)", () => {
  it("denies bare force-push but allows the safe lease form", () => {
    assert.ok(destructiveReason("git push origin main --force"));
    assert.equal(destructiveReason("git push --force-with-lease origin main"), null);
  });
});
