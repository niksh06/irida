import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { maybeStartSideWebhook } from "../src/gateway_cmd.js";
import { GatewaySessionRouter } from "../src/gatewayRouter.js";
import type { GatewayConfig } from "../src/gatewayConfig.js";

// I-147: a Telegram gateway ALSO serves the local HTTP hook when (and only
// when) a webhook secret is configured — the Wisp desktop chat peer.

const SECRET_ENV = "IRIDA_TEST_SIDE_HOOK_SECRET";

function cfgOf(over: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    version: 1,
    adapter: "telegram",
    host: "127.0.0.1",
    port: 0, // ephemeral — tests must not collide with a real gateway
    webhookPath: "/hook",
    secretEnv: SECRET_ENV,
    allowedChatIds: ["desktop"],
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
  };
}

function withSecret<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env[SECRET_ENV];
  if (value === undefined) delete process.env[SECRET_ENV];
  else process.env[SECRET_ENV] = value;
  return fn().finally(() => {
    if (prev === undefined) delete process.env[SECRET_ENV];
    else process.env[SECRET_ENV] = prev;
  });
}

describe("gateway side webhook (I-147)", () => {
  it("no secret → no HTTP surface (deny by default)", async () => {
    await withSecret(undefined, async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "side-hook-"));
      const router = new GatewaySessionRouter({ dir, adapter: "telegram" });
      const webhook = await maybeStartSideWebhook(cfgOf(), router, dir);
      assert.equal(webhook, undefined);
    });
  });

  it("secret set → listener starts; wrong secret 401, unknown chat 403", async () => {
    await withSecret("side-hook-test-secret", async () => {
      const dir = mkdtempSync(resolve(tmpdir(), "side-hook-"));
      const router = new GatewaySessionRouter({ dir, adapter: "telegram" });
      const webhook = await maybeStartSideWebhook(cfgOf(), router, dir);
      assert.ok(webhook, "listener must start when the secret is configured");
      try {
        const port = (webhook!.server.address() as AddressInfo).port;
        const url = `http://127.0.0.1:${port}/hook`;
        const post = (headers: Record<string, string>, body: unknown) =>
          fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify(body),
          });

        const noAuth = await post({}, { chatId: "desktop", text: "hi" });
        assert.equal(noAuth.status, 401);

        const badAuth = await post({ "x-gateway-secret": "nope" }, { chatId: "desktop", text: "hi" });
        assert.equal(badAuth.status, 401);

        const badChat = await post(
          { "x-gateway-secret": "side-hook-test-secret" },
          { chatId: "stranger", text: "hi" }
        );
        assert.equal(badChat.status, 403);
      } finally {
        await webhook!.close();
      }
    });
  });
});
