import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  getChatMode,
  setChatMode,
  clearChatMode,
  applyChatModePrefix,
} from "../src/gatewayModeStore.js";

function sandbox() {
  const dir = mkdtempSync(resolve(tmpdir(), "gw-mode-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(join(dir, "agent.config.json"), JSON.stringify({ stateDir: ".agent" }) + "\n");
  const prev = process.env.IRIDA_HOME;
  process.env.IRIDA_HOME = dir;
  return {
    dir,
    restore: () => {
      prev === undefined ? delete process.env.IRIDA_HOME : (process.env.IRIDA_HOME = prev);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("applyChatModePrefix: sticky mode prepends, explicit prefix wins, none is no-op", () => {
  assert.equal(applyChatModePrefix("ship the fix", "do"), "DO: ship the fix");
  assert.equal(applyChatModePrefix("review this", "advice"), "ADVICE: review this");
  // explicit prefix in the message always wins over the sticky mode
  assert.equal(applyChatModePrefix("ADVICE: just discuss", "do"), "ADVICE: just discuss");
  assert.equal(applyChatModePrefix("DO: now", "advice"), "DO: now");
  // no sticky mode → unchanged
  assert.equal(applyChatModePrefix("hello", undefined), "hello");
});

test("set / get / clear a chat's sticky mode (persisted)", () => {
  const sb = sandbox();
  try {
    assert.equal(getChatMode(sb.dir, "telegram", "123"), undefined);
    setChatMode(sb.dir, "telegram", "123", "debug");
    assert.equal(getChatMode(sb.dir, "telegram", "123"), "debug");
    // per-chat isolation
    assert.equal(getChatMode(sb.dir, "telegram", "999"), undefined);
    setChatMode(sb.dir, "telegram", "123", "sync"); // overwrite
    assert.equal(getChatMode(sb.dir, "telegram", "123"), "sync");
    assert.equal(clearChatMode(sb.dir, "telegram", "123"), true);
    assert.equal(getChatMode(sb.dir, "telegram", "123"), undefined);
    assert.equal(clearChatMode(sb.dir, "telegram", "123"), false); // already clear
  } finally {
    sb.restore();
  }
});
