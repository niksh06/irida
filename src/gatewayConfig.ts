/**
 * Gateway auth + validation layer (issue 037).
 *
 * Sits on top of the gatewayConfigTypes leaf and the allowlist/pairing modules.
 * The parsing/types live in gatewayConfigTypes.ts (Arch-2 — breaks the former
 * gatewayConfig ↔ allowlist ↔ pairing import cycle); this file re-exports them
 * so existing `from "./gatewayConfig.js"` imports keep working.
 */
import { loadConfig } from "./config.js";
import { resolveTelegramBotToken } from "./credentials.js";
import { isChatApproved } from "./gatewayPairingStore.js";
import {
  ALLOWLIST_STORAGE_PG,
  GatewayConfigError,
  gatewayWebhookSecret,
  loadGatewayConfig,
  type GatewayConfig,
} from "./gatewayConfigTypes.js";
import { pgGatewayAllowlistEnabled, resolveAllowedChatIds } from "./gatewayAllowlist.js";

export {
  GATEWAY_FILE,
  ALLOWLIST_STORAGE_PG,
  GatewayConfigError,
  gatewayConfigPath,
  loadGatewayConfig,
  gatewayWebhookSecret,
} from "./gatewayConfigTypes.js";
export type { GatewayConfig } from "./gatewayConfigTypes.js";

export function validateGatewayConfig(dir: string = process.cwd()): string[] {
  try {
    const cfg = loadGatewayConfig(dir);
    if (cfg.adapter === "webhook" && !gatewayWebhookSecret(cfg)) {
      return [`webhook secret env ${cfg.secretEnv} is unset`];
    }
    if (cfg.adapter === "telegram" && !resolveTelegramBotToken(dir, cfg.telegramTokenEnv).value) {
      return [`telegram token env ${cfg.telegramTokenEnv} is unset and not in ${loadConfig(dir).stateDir}/credentials.json`];
    }
    const resolved = resolveAllowedChatIds(cfg, dir);
    if (resolved.length === 0) {
      if (pgGatewayAllowlistEnabled() && cfg.allowedChatIdsStorage === ALLOWLIST_STORAGE_PG) {
        return ["gateway allowlist empty in postgres — add peers or restore from backup"];
      }
      return ["allowedChatIds is empty — gateway denies all peers until configured"];
    }
    if (pgGatewayAllowlistEnabled() && cfg.allowedChatIds.length > 0 && cfg.allowedChatIdsStorage !== ALLOWLIST_STORAGE_PG) {
      return ["plaintext allowedChatIds in gateway.json while postgres allowlist is enabled — run gateway once to migrate or clear file list"];
    }
    // A negative chat id is a group/supergroup/channel — there every member (or
    // channel admin) inherits agent control unless a sender policy is set.
    const negative = resolved.filter((id) => id.startsWith("-"));
    if (
      cfg.adapter === "telegram" &&
      negative.length > 0 &&
      cfg.telegramAllowedSenderIds.length === 0 &&
      !cfg.telegramAllowChannelPosts
    ) {
      return [
        `allowlist has group/channel id(s) ${negative.join(", ")} but no sender policy — any member could drive the agent; set telegram.allowedSenderIds (groups) or telegram.allowChannelPosts (channels)`,
      ];
    }
    return [];
  } catch (e) {
    return [e instanceof GatewayConfigError ? e.message : String(e)];
  }
}

export function isChatAllowed(cfg: GatewayConfig, chatId: string, dir?: string): boolean {
  const allowed = dir ? resolveAllowedChatIds(cfg, dir) : cfg.allowedChatIds;
  if (allowed.length === 0) return false;
  if (allowed.includes(chatId)) return true;
  if (dir && !pgGatewayAllowlistEnabled()) return isChatApproved(cfg.allowedChatIds, dir, chatId);
  return false;
}
