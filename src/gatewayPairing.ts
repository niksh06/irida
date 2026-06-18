/**
 * Gateway pairing lite (I-26) — approve new chatIds via /approve <code>.
 *
 * High-level register/approve operations. The pairing-file primitives live in
 * gatewayPairingStore.ts (Arch-2 leaf) and are re-exported here for back-compat.
 */
import { randomBytes } from "node:crypto";
import { loadGatewayConfig } from "./gatewayConfigTypes.js";
import { persistGatewayAllowedChatId, resolveAllowedChatIds } from "./gatewayAllowlist.js";
import { pgGatewayAllowlistEnabled } from "./gatewayAllowedPg.js";
import {
  loadPairingFile,
  savePairingFile,
  PAIRING_PENDING_MAX,
} from "./gatewayPairingStore.js";

export {
  PAIRING_FILE,
  PAIRING_PENDING_MAX,
  PAIRING_PENDING_TTL_MS,
  loadPairingFile,
  savePairingFile,
  isChatApproved,
} from "./gatewayPairingStore.js";
export type { PairingFile, PairingPending } from "./gatewayPairingStore.js";

function newCode(): string {
  // 6 random bytes = 48 bits of entropy; the short 3-byte code was guessable.
  return randomBytes(6).toString("hex").toUpperCase();
}

/** Unknown chat requests access — returns message with pairing code. */
export function tryRegisterPairing(
  dir: string,
  adapter: string,
  chatId: string
): { registered: boolean; message: string } {
  const data = loadPairingFile(dir);
  const existing = data.pending.find((p) => p.chatId === chatId);
  if (existing) {
    return {
      registered: true,
      message:
        `csagent: чат не в allowlist.\nКод pairing: **${existing.code}**\nАдмин в разрешённом чате: /approve ${existing.code}`,
    };
  }
  const code = newCode();
  data.pending.push({
    code,
    chatId,
    adapter,
    createdAt: new Date().toISOString(),
  });
  // Cap: evict oldest pending codes so unknown chats cannot grow the file unbounded.
  if (data.pending.length > PAIRING_PENDING_MAX) {
    data.pending.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    data.pending.splice(0, data.pending.length - PAIRING_PENDING_MAX);
  }
  savePairingFile(dir, data);
  return {
    registered: true,
    message:
      `csagent: чат не в allowlist.\nКод pairing: **${code}**\nАдмин: /approve ${code}`,
  };
}

/** Admin (must already be allowed) approves a pending code. */
export async function tryApprovePairing(
  dir: string,
  adminChatId: string,
  code: string
): Promise<{ ok: boolean; message: string }> {
  const cfg = loadGatewayConfig(dir);
  const allowed = resolveAllowedChatIds(cfg, dir);
  if (!allowed.includes(adminChatId)) {
    return { ok: false, message: "Только разрешённый чат может /approve." };
  }
  const norm = code.trim().toUpperCase();
  const data = loadPairingFile(dir);
  const idx = data.pending.findIndex((p) => p.code.toUpperCase() === norm);
  if (idx < 0) {
    return { ok: false, message: `Код «${code}» не найден.` };
  }
  const pending = data.pending[idx]!;
  // When the allowlist lives in Postgres it is the sole source of truth and the
  // plaintext `approved` list is ignored by resolveAllowedChatIds — writing it
  // would only leave a stale, plaintext record of who paired. Skip it there.
  if (!pgGatewayAllowlistEnabled() && !data.approved.includes(pending.chatId)) {
    data.approved.push(pending.chatId);
  }
  data.pending.splice(idx, 1);
  savePairingFile(dir, data);
  await persistGatewayAllowedChatId(dir, pending.chatId, "pairing");
  return {
    ok: true,
    message: `OK: chat ${pending.chatId} одобрен (pairing ${norm}).`,
  };
}
