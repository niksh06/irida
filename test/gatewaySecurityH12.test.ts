import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { tryRegisterPairing, loadPairingFile, savePairingFile } from "../src/gatewayPairing.js";
import { processTelegramUpdate } from "../src/gatewayTelegram.js";
import { saveTelegramPollOffset, loadTelegramPollOffset } from "../src/gatewayTelegramOffset.js";
import type { GatewayConfig } from "../src/gatewayConfig.js";
import type { GatewaySessionRouter } from "../src/gatewayRouter.js";

// H-12: gateway hardening — pairing reply cooldown, edited_message ignore,
// atomic offset persistence.

function tmp(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "h12-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(join(dir, "agent.config.json"), JSON.stringify({ stateDir: ".agent" }), "utf8");
  return dir;
}

const cfgOf = (over: Partial<GatewayConfig> = {}): GatewayConfig =>
  ({
    version: 1,
    adapter: "telegram",
    host: "127.0.0.1",
    port: 0,
    webhookPath: "/hook",
    secretEnv: "X",
    allowedChatIds: ["42"],
    maxMessageLength: 8000,
    skills: [],
    telegramTokenEnv: "TELEGRAM_BOT_TOKEN",
    telegramPollIntervalMs: 1500,
    telegramShowTyping: false,
    telegramShowToolProgress: false,
    telegramToolProgressMode: "new",
    telegramMessageFormat: "plain",
    telegramAllowedSenderIds: [],
    telegramAllowChannelPosts: false,
    ...over,
  }) as GatewayConfig;

describe("pairing reply cooldown (H-12)", () => {
  it("first contact replies with a code; repeats inside the window are silent", () => {
    const dir = tmp();
    const first = tryRegisterPairing(dir, "telegram", "stranger-1");
    assert.ok(first.message, "first contact must deliver the code");
    const again = tryRegisterPairing(dir, "telegram", "stranger-1");
    assert.equal(again.message, undefined, "cooldown must silence the repeat");
    assert.equal(again.registered, true);

    // Window expired → the code is re-sent (still the SAME code).
    const data = loadPairingFile(dir);
    data.pending[0]!.lastNotifiedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    savePairingFile(dir, data);
    const later = tryRegisterPairing(dir, "telegram", "stranger-1");
    assert.ok(later.message);
    assert.match(later.message!, new RegExp(data.pending[0]!.code));
  });
});

describe("edited messages (H-12)", () => {
  it("edited_message does not fire a turn (and gets no pairing reply)", async () => {
    const dir = tmp();
    const router = { isBusy: () => false } as unknown as GatewaySessionRouter;
    const out = await processTelegramUpdate(
      cfgOf(),
      router,
      { update_id: 1, edited_message: { message_id: 5, text: "edited!", chat: { id: 42, type: "private" } } } as never,
      { dir }
    );
    assert.deepEqual(out, { handled: false });
  });
});

describe("atomic offset (H-12)", () => {
  it("persists via atomic write and leaves no tmp droppings", () => {
    const dir = tmp();
    saveTelegramPollOffset(dir, 814_000_001);
    assert.equal(loadTelegramPollOffset(dir), 814_000_001);
    const entries = readdirSync(join(dir, ".agent")).filter((f) => f.includes("offset"));
    assert.deepEqual(entries, ["gateway.telegram.offset"]);
    assert.equal(readFileSync(join(dir, ".agent", "gateway.telegram.offset"), "utf8"), "814000001");
  });
});
