/**
 * Session ownership by entry channel — keeps Telegram gateway and TUI isolated.
 */
import type { SessionRecord } from "./store.js";

export const SESSION_CHANNEL = {
  telegram: "telegram",
  webhook: "webhook",
  tui: "tui",
  cli: "cli",
  cron: "cron",
  run: "run",
} as const;

export type SessionChannel = (typeof SESSION_CHANNEL)[keyof typeof SESSION_CHANNEL];

const GATEWAY_CHANNELS = new Set<string>([SESSION_CHANNEL.telegram, SESSION_CHANNEL.webhook]);

export function isGatewaySession(session: SessionRecord, gatewayPeerIds?: Set<string>): boolean {
  const ch = session.channel?.trim() ?? "";
  if (GATEWAY_CHANNELS.has(ch)) return true;
  return gatewayPeerIds?.has(session.id) ?? false;
}

/** Whether `session` may be opened from the given channel (e.g. TUI). */
export function sessionAllowedForChannel(
  session: SessionRecord,
  channel: SessionChannel | undefined,
  gatewayPeerIds?: Set<string>
): boolean {
  if (!channel) return true;
  if (channel === SESSION_CHANNEL.tui) {
    if (isGatewaySession(session, gatewayPeerIds)) return false;
    const ch = session.channel?.trim() ?? "";
    if (ch && ch !== SESSION_CHANNEL.tui && ch !== SESSION_CHANNEL.cli) return false;
    return true;
  }
  const ch = session.channel?.trim() ?? "";
  if (!ch) return true;
  return ch === channel;
}

export function sessionChannelConflictMessage(session: SessionRecord): string {
  const ch = session.channel?.trim();
  if (ch === SESSION_CHANNEL.telegram || ch === SESSION_CHANNEL.webhook) {
    return `session '${session.id}' is used by the ${ch} gateway — use /new in Telegram or pick a TUI session`;
  }
  return `session '${session.id}' belongs to ${ch ?? "gateway"} — not available in TUI`;
}
