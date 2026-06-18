/**
 * Gateway allowlist resolution — Postgres (encrypted) or gateway.json (SQLite).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALLOWLIST_STORAGE_PG, gatewayConfigPath, type GatewayConfig } from "./gatewayConfigTypes.js";
export { pgGatewayAllowlistEnabled } from "./gatewayAllowedPg.js";
export { ALLOWLIST_STORAGE_PG } from "./gatewayConfigTypes.js";
import {
  addPgAllowedChatId,
  loadPgAllowedChatIds,
  pgGatewayAllowlistEnabled,
  type GatewayAllowSource,
} from "./gatewayAllowedPg.js";
import { loadPairingFile, savePairingFile } from "./gatewayPairingStore.js";
import { guardProdStateWrite, writeFileAtomic } from "./util.js";
export const GATEWAY_KNOWN_TEST_CHAT_IDS = new Set([
  "99",
  "42",
  "u1",
  "dev",
  "paired-1",
  "admin-chat",
  "new-chat",
  "stranger",
]);

let pgAllowlistCache: string[] | null = null;
let pgAllowlistReady = false;

export function isGatewayAllowlistPgStorage(cfg: GatewayConfig): boolean {
  return cfg.allowedChatIdsStorage === ALLOWLIST_STORAGE_PG || pgGatewayAllowlistEnabled();
}

export function pgAllowlistCacheReady(): boolean {
  return pgAllowlistReady;
}

export function setPgAllowlistCache(ids: string[]): void {
  pgAllowlistCache = [...ids];
  pgAllowlistReady = true;
}

export function clearPgAllowlistCache(): void {
  pgAllowlistCache = null;
  pgAllowlistReady = false;
}

function readGatewayJsonObject(dir: string): Record<string, unknown> {
  const path = gatewayConfigPath(dir);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function plaintextAllowlistFromFile(dir: string): string[] {
  const o = readGatewayJsonObject(dir);
  if (!Array.isArray(o.allowedChatIds)) return [];
  return o.allowedChatIds
    .filter((id): id is string => typeof id === "string" && id.trim() !== "")
    .map((id) => id.trim());
}

function markGatewayAllowlistPgStorage(dir: string): void {
  const path = gatewayConfigPath(dir);
  guardProdStateWrite(resolve(path, ".."), "gateway.json");
  const o = readGatewayJsonObject(dir);
  o.allowedChatIdsStorage = ALLOWLIST_STORAGE_PG;
  o.allowedChatIds = [];
  writeFileAtomic(path, JSON.stringify(o, null, 2) + "\n");
}

/** Import file allowlist + pairing approved into Postgres; strip plaintext from disk. */
export async function migrateGatewayAllowlistToPg(dir: string): Promise<number> {
  if (!pgGatewayAllowlistEnabled()) return 0;
  const fromGateway = plaintextAllowlistFromFile(dir);
  const pairing = loadPairingFile(dir);
  let added = 0;
  for (const chatId of fromGateway) {
    if (await addPgAllowedChatId(chatId, { source: "allowlist" })) added++;
  }
  for (const chatId of pairing.approved) {
    if (await addPgAllowedChatId(chatId, { source: "pairing" })) added++;
  }
  if (fromGateway.length > 0 || pairing.approved.length > 0) {
    markGatewayAllowlistPgStorage(dir);
    if (pairing.approved.length > 0) {
      savePairingFile(dir, { ...pairing, approved: [] });
    }
  }
  return added;
}

/** Load encrypted allowlist from Postgres; migrate plaintext file on first run. */
export async function warmGatewayAllowlistCache(dir: string = process.cwd()): Promise<void> {
  if (!pgGatewayAllowlistEnabled()) {
    clearPgAllowlistCache();
    return;
  }
  try {
    let ids = await loadPgAllowedChatIds();
    if (ids.length === 0) {
      await migrateGatewayAllowlistToPg(dir);
      ids = await loadPgAllowedChatIds();
    } else {
      const plaintext = plaintextAllowlistFromFile(dir);
      if (plaintext.length > 0) {
        for (const chatId of plaintext) {
          await addPgAllowedChatId(chatId, { source: "allowlist" });
        }
        markGatewayAllowlistPgStorage(dir);
        ids = await loadPgAllowedChatIds();
      }
    }
    setPgAllowlistCache(ids);
  } catch {
    clearPgAllowlistCache();
  }
}

export async function persistGatewayAllowedChatId(
  dir: string,
  chatId: string,
  source: GatewayAllowSource = "pairing"
): Promise<void> {
  if (!pgGatewayAllowlistEnabled()) return;
  const added = await addPgAllowedChatId(chatId, { source });
  if (added || pgAllowlistReady) {
    const ids = await loadPgAllowedChatIds();
    setPgAllowlistCache(ids);
  }
  void dir;
}

export function resolveAllowedChatIds(cfg: GatewayConfig, dir: string): string[] {
  if (pgGatewayAllowlistEnabled() && pgAllowlistReady && pgAllowlistCache) {
    return pgAllowlistCache;
  }
  if (cfg.allowedChatIdsStorage === ALLOWLIST_STORAGE_PG && pgGatewayAllowlistEnabled() && !pgAllowlistReady) {
    return [];
  }
  const ids = [...cfg.allowedChatIds];
  if (!pgGatewayAllowlistEnabled()) {
    const pairing = loadPairingFile(dir);
    for (const chatId of pairing.approved) {
      if (!ids.includes(chatId)) ids.push(chatId);
    }
  }
  return ids;
}

export function hasPlaintextGatewayAllowlist(dir: string): boolean {
  return plaintextAllowlistFromFile(dir).length > 0;
}

export function gatewayAllowlistHasTestIds(ids: string[]): string[] {
  return ids.filter((id) => GATEWAY_KNOWN_TEST_CHAT_IDS.has(id));
}
