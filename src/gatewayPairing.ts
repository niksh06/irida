/**
 * Gateway pairing lite (I-26) — approve new chatIds via /approve <code>.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";

export const PAIRING_FILE = "gateway.pairing.json";

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

export function loadPairingFile(dir: string): PairingFile {
  const path = pairingPath(dir);
  if (!existsSync(path)) {
    return { version: 1, approved: [], pending: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PairingFile;
    return {
      version: 1,
      approved: Array.isArray(parsed.approved) ? parsed.approved.map(String) : [],
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
    };
  } catch {
    return { version: 1, approved: [], pending: [] };
  }
}

export function savePairingFile(dir: string, data: PairingFile): void {
  const path = pairingPath(dir);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function isChatApproved(
  allowedChatIds: string[],
  dir: string,
  chatId: string
): boolean {
  if (allowedChatIds.includes(chatId)) return true;
  const pairing = loadPairingFile(dir);
  return pairing.approved.includes(chatId);
}

function newCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
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
  savePairingFile(dir, data);
  return {
    registered: true,
    message:
      `csagent: чат не в allowlist.\nКод pairing: **${code}**\nАдмин: /approve ${code}`,
  };
}

/** Admin (must already be allowed) approves a pending code. */
export function tryApprovePairing(
  dir: string,
  adminChatId: string,
  code: string
): { ok: boolean; message: string } {
  const cfg = loadConfig(dir);
  const gwPath = resolve(dir, cfg.stateDir, "gateway.json");
  let allowed: string[] = [];
  if (existsSync(gwPath)) {
    try {
      const gw = JSON.parse(readFileSync(gwPath, "utf8")) as { allowedChatIds?: string[] };
      allowed = Array.isArray(gw.allowedChatIds) ? gw.allowedChatIds.map(String) : [];
    } catch {
      allowed = [];
    }
  }
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
  if (!data.approved.includes(pending.chatId)) {
    data.approved.push(pending.chatId);
  }
  data.pending.splice(idx, 1);
  savePairingFile(dir, data);
  return {
    ok: true,
    message: `OK: chat ${pending.chatId} одобрен (pairing ${norm}).`,
  };
}
