import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { tryRegisterPairing, tryApprovePairing } from "../src/gatewayPairing.js";

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
