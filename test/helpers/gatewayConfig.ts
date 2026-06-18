/**
 * Test helper: write an example gateway.json (Arch-3 — moved out of the prod
 * module src/gateway_cmd.ts). Always writes under dir/.agent, and the prod-state
 * guard refuses CSAGENT_HOME/.agent during tests.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { GATEWAY_FILE, type GatewayConfig } from "../../src/gatewayConfigTypes.js";
import { guardProdStateWrite } from "../../src/util.js";

export function writeExampleGatewayConfig(dir: string, partial: Partial<GatewayConfig> = {}): GatewayConfig {
  const root = resolve(dir, ".agent");
  guardProdStateWrite(root, GATEWAY_FILE);
  mkdirSync(root, { recursive: true });
  const example: GatewayConfig = {
    version: 1,
    adapter: "webhook",
    host: "127.0.0.1",
    port: partial.port ?? 18789,
    webhookPath: "/hook",
    secretEnv: "GATEWAY_WEBHOOK_SECRET",
    allowedChatIds: ["u1"],
    maxMessageLength: 8000,
    skills: [],
    telegramTokenEnv: "TELEGRAM_BOT_TOKEN",
    telegramPollIntervalMs: 1500,
    telegramShowTyping: true,
    telegramShowToolProgress: false,
    telegramToolProgressMode: "new",
    telegramMessageFormat: "rich",
    telegramAllowedSenderIds: [],
    telegramAllowChannelPosts: false,
    ...partial,
  };
  const json: Record<string, unknown> = {
    version: 1,
    adapter: example.adapter,
    allowedChatIds: example.allowedChatIds,
    maxMessageLength: example.maxMessageLength,
    skills: example.skills,
  };
  if (example.adapter === "webhook") {
    json.listen = { host: example.host, port: example.port };
    json.webhook = { path: example.webhookPath, secretEnv: example.secretEnv };
  } else {
    json.telegram = {
      tokenEnv: example.telegramTokenEnv,
      pollIntervalMs: example.telegramPollIntervalMs,
      showTyping: example.telegramShowTyping,
      showToolProgress: example.telegramShowToolProgress,
      toolProgressMode: example.telegramToolProgressMode,
      messageFormat: example.telegramMessageFormat,
      allowedSenderIds: example.telegramAllowedSenderIds,
      allowChannelPosts: example.telegramAllowChannelPosts,
    };
  }
  writeFileSync(resolve(root, GATEWAY_FILE), JSON.stringify(json, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  return example;
}
