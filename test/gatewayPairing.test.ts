import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  loadPairingFile,
  savePairingFile,
  tryRegisterPairing,
  tryApprovePairing,
  PAIRING_PENDING_MAX,
} from "../src/gatewayPairing.js";

function seedGateway(dir: string, allowed: string[]): void {
  mkdirSync(resolve(dir, ".agent"), { recursive: true });
  writeFileSync(
    resolve(dir, "agent.config.json"),
    JSON.stringify({ stateDir: ".agent", cwd: dir }),
    "utf8"
  );
  writeFileSync(
    resolve(dir, ".agent", "gateway.json"),
    JSON.stringify({ version: 1, allowedChatIds: allowed, adapter: "telegram", skills: [] }),
    "utf8"
  );
}

test("pairing register + approve flow", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "pair-"));
  seedGateway(dir, ["admin-chat"]);
  const reg = tryRegisterPairing(dir, "telegram", "new-chat");
  assert.equal(reg.registered, true);
  assert.match(reg.message, /\/approve/);
  const codeMatch = reg.message.match(/([A-F0-9]{6})/);
  assert.ok(codeMatch);
  const approved = tryApprovePairing(dir, "admin-chat", codeMatch![1]!);
  assert.equal(approved.ok, true);
  const denied = tryApprovePairing(dir, "new-chat", codeMatch![1]!);
  assert.equal(denied.ok, false);
});

test("pairing: same chat reuses code, pending capped, stale expired (I-35)", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "pair-limit-"));
  seedGateway(dir, ["admin-chat"]);

  // Same chat twice → same code, one entry.
  const first = tryRegisterPairing(dir, "telegram", "spammer");
  const second = tryRegisterPairing(dir, "telegram", "spammer");
  const c1 = first.message.match(/([A-F0-9]{6})/)![1];
  const c2 = second.message.match(/([A-F0-9]{6})/)![1];
  assert.equal(c1, c2);
  assert.equal(loadPairingFile(dir).pending.length, 1);

  // Flood of distinct chats → capped, oldest evicted.
  for (let i = 0; i < PAIRING_PENDING_MAX + 10; i++) {
    tryRegisterPairing(dir, "telegram", `chat-${i}`);
  }
  const afterFlood = loadPairingFile(dir);
  assert.equal(afterFlood.pending.length, PAIRING_PENDING_MAX);
  assert.ok(!afterFlood.pending.some((p) => p.chatId === "spammer"));

  // Stale entries (>24h) expire on load.
  const stale = {
    code: "AAAAAA",
    chatId: "old-chat",
    adapter: "telegram",
    createdAt: new Date(Date.now() - 25 * 3600_000).toISOString(),
  };
  savePairingFile(dir, { version: 1, approved: [], pending: [stale] });
  assert.equal(loadPairingFile(dir).pending.length, 0);
});
