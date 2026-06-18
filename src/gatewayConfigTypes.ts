/**
 * Gateway config: types, parsing, and path resolution (Arch-2 leaf).
 *
 * This module is the dependency *leaf* for the gateway config/allowlist/pairing
 * cluster — it imports nothing from gateway* so allowlist and pairing can depend
 * on it without forming a cycle. Auth helpers that need the allowlist
 * (`isChatAllowed`, `validateGatewayConfig`) live in gatewayConfig.ts on top.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";

export const GATEWAY_FILE = "gateway.json";

/** Marker for "allowlist lives in Postgres (encrypted)". */
export const ALLOWLIST_STORAGE_PG = "pg";

export interface GatewayConfig {
  version: number;
  adapter: "webhook" | "telegram";
  host: string;
  port: number;
  webhookPath: string;
  /** Env var name holding shared webhook secret. */
  secretEnv: string;
  allowedChatIds: string[];
  /** When "pg", allowlist lives in Postgres (encrypted); file list must be empty. */
  allowedChatIdsStorage?: "pg";
  maxMessageLength: number;
  skills: string[];
  yesIUnderstand?: boolean;
  /** Env var for Telegram bot token (adapter=telegram). */
  telegramTokenEnv: string;
  telegramPollIntervalMs: number;
  /** Send sendChatAction typing while agent runs (default true). */
  telegramShowTyping: boolean;
  /** Post tool-call lines as separate messages (Hermes-style). */
  telegramShowToolProgress: boolean;
  /** "new" = only when tool name changes; "all" = every tool call. */
  telegramToolProgressMode: "new" | "all";
  /** Outbound formatting: rich (sendRichMessage markdown) | html | plain. */
  telegramMessageFormat: "rich" | "html" | "plain";
  /**
   * User IDs (from.id) permitted to drive the agent inside allowlisted
   * group/supergroup chats. The chat allowlist alone is not enough there —
   * any member could otherwise act as the operator. Empty → groups denied.
   */
  telegramAllowedSenderIds: string[];
  /**
   * Act on channel_post from allowlisted channels. Channel posts carry no
   * per-user sender, so this is an explicit opt-in (only channel admins post).
   */
  telegramAllowChannelPosts: boolean;
}

export class GatewayConfigError extends Error {}

export function gatewayConfigPath(dir: string = process.cwd()): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, GATEWAY_FILE);
}

function resolveSecret(envName: string): string {
  const name = envName.trim() || "GATEWAY_WEBHOOK_SECRET";
  return (process.env[name] ?? "").trim();
}

export function loadGatewayConfig(dir: string = process.cwd()): GatewayConfig {
  const path = gatewayConfigPath(dir);
  if (!existsSync(path)) {
    throw new GatewayConfigError(
      `missing ${GATEWAY_FILE} — create .agent/gateway.json (see: csagent gateway help)`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new GatewayConfigError(`cannot parse ${GATEWAY_FILE}: ${(e as Error).message}`);
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GatewayConfigError(`${GATEWAY_FILE} must be a JSON object`);
  }
  const o = parsed as Record<string, unknown>;
  const adapterRaw = typeof o.adapter === "string" ? o.adapter.trim() : "webhook";
  if (adapterRaw !== "webhook" && adapterRaw !== "telegram") {
    throw new GatewayConfigError(`adapter must be 'webhook' or 'telegram', got '${adapterRaw}'`);
  }
  const listen =
    o.listen && typeof o.listen === "object" && !Array.isArray(o.listen)
      ? (o.listen as Record<string, unknown>)
      : {};
  const webhook =
    o.webhook && typeof o.webhook === "object" && !Array.isArray(o.webhook)
      ? (o.webhook as Record<string, unknown>)
      : {};
  const host = typeof listen.host === "string" && listen.host.trim() ? listen.host.trim() : "127.0.0.1";
  const port = typeof listen.port === "number" && listen.port > 0 ? listen.port : 18789;
  const webhookPath =
    typeof webhook.path === "string" && webhook.path.trim() ? webhook.path.trim() : "/hook";
  const secretEnv =
    typeof webhook.secretEnv === "string" && webhook.secretEnv.trim()
      ? webhook.secretEnv.trim()
      : "GATEWAY_WEBHOOK_SECRET";
  const allowedChatIdsStorage =
    o.allowedChatIdsStorage === ALLOWLIST_STORAGE_PG ? ALLOWLIST_STORAGE_PG : undefined;
  const allowedChatIds = Array.isArray(o.allowedChatIds)
    ? o.allowedChatIds
        .filter((id): id is string => typeof id === "string" && id.trim() !== "")
        .map((id) => id.trim())
    : [];
  const maxMessageLength =
    typeof o.maxMessageLength === "number" && o.maxMessageLength > 0 ? o.maxMessageLength : 8000;
  const telegram =
    o.telegram && typeof o.telegram === "object" && !Array.isArray(o.telegram)
      ? (o.telegram as Record<string, unknown>)
      : {};
  const telegramTokenEnv =
    typeof telegram.tokenEnv === "string" && telegram.tokenEnv.trim()
      ? telegram.tokenEnv.trim()
      : "TELEGRAM_BOT_TOKEN";
  const telegramPollIntervalMs =
    typeof telegram.pollIntervalMs === "number" && telegram.pollIntervalMs >= 500
      ? telegram.pollIntervalMs
      : 1500;
  const telegramShowTyping = telegram.showTyping !== false;
  const telegramShowToolProgress = telegram.showToolProgress === true;
  const toolProgressRaw =
    typeof telegram.toolProgressMode === "string" ? telegram.toolProgressMode.trim() : "new";
  const telegramToolProgressMode = toolProgressRaw === "all" ? "all" : "new";
  const formatRaw =
    typeof telegram.messageFormat === "string" ? telegram.messageFormat.trim().toLowerCase() : "rich";
  const telegramMessageFormat =
    formatRaw === "html" || formatRaw === "plain" ? formatRaw : "rich";
  const telegramAllowedSenderIds = Array.isArray(telegram.allowedSenderIds)
    ? telegram.allowedSenderIds
        .filter((id): id is string | number => typeof id === "string" || typeof id === "number")
        .map((id) => String(id).trim())
        .filter((id) => id !== "")
    : [];
  const telegramAllowChannelPosts = telegram.allowChannelPosts === true;
  const skills = Array.isArray(o.skills)
    ? o.skills.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim())
    : [];
  return {
    version: 1,
    adapter: adapterRaw,
    host,
    port,
    webhookPath,
    secretEnv,
    allowedChatIds,
    allowedChatIdsStorage,
    maxMessageLength,
    skills,
    yesIUnderstand: o.yesIUnderstand === true,
    telegramTokenEnv,
    telegramPollIntervalMs,
    telegramShowTyping,
    telegramShowToolProgress,
    telegramToolProgressMode,
    telegramMessageFormat,
    telegramAllowedSenderIds,
    telegramAllowChannelPosts,
  };
}

export function gatewayWebhookSecret(cfg: GatewayConfig): string {
  return resolveSecret(cfg.secretEnv);
}
