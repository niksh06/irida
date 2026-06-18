/**
 * Pairing-file primitives (Arch-2 leaf): read/write `gateway.pairing.json` and
 * the approved-chat check. Depends only on config + util — no allowlist, so the
 * allowlist module can use these without the former pairing ↔ allowlist cycle.
 * High-level pairing operations (register/approve) live in gatewayPairing.ts.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { guardProdStateWrite, writeFileAtomic } from "./util.js";

export const PAIRING_FILE = "gateway.pairing.json";
/** Unknown chats can spam pairing requests — cap pending and expire stale codes (I-35). */
export const PAIRING_PENDING_MAX = 20;
export const PAIRING_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export interface PairingPending {
  code: string;
  chatId: string;
  adapter: string;
  createdAt: string;
}

export interface PairingFile {
  version: number;
  approved: string[];
  pending: PairingPending[];
}

function pairingPath(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, PAIRING_FILE);
}

function pendingFresh(p: PairingPending, now: number): boolean {
  const t = Date.parse(p.createdAt);
  return Number.isFinite(t) && now - t <= PAIRING_PENDING_TTL_MS;
}

export function loadPairingFile(dir: string): PairingFile {
  const path = pairingPath(dir);
  if (!existsSync(path)) {
    return { version: 1, approved: [], pending: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PairingFile;
    const now = Date.now();
    const pending = Array.isArray(parsed.pending)
      ? parsed.pending.filter((p) => pendingFresh(p, now))
      : [];
    return {
      version: 1,
      approved: Array.isArray(parsed.approved) ? parsed.approved.map(String) : [],
      pending,
    };
  } catch {
    return { version: 1, approved: [], pending: [] };
  }
}

export function savePairingFile(dir: string, data: PairingFile): void {
  const path = pairingPath(dir);
  guardProdStateWrite(resolve(path, ".."), PAIRING_FILE);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileAtomic(path, JSON.stringify(data, null, 2) + "\n");
}

export function isChatApproved(allowedChatIds: string[], dir: string, chatId: string): boolean {
  if (allowedChatIds.includes(chatId)) return true;
  const pairing = loadPairingFile(dir);
  return pairing.approved.includes(chatId);
}
