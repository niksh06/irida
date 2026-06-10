/**
 * Gateway peer → session mapping (gateway.peers.json).
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { writeFileAtomic } from "./util.js";

export const GATEWAY_PEERS_FILE = "gateway.peers.json";

export interface GatewayPeersFile {
  version: number;
  peers: Record<string, string>;
}

function peersPath(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, GATEWAY_PEERS_FILE);
}

export function loadGatewayPeers(dir: string): GatewayPeersFile {
  const path = peersPath(dir);
  if (!existsSync(path)) return { version: 1, peers: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<GatewayPeersFile>;
    return {
      version: 1,
      peers: parsed.peers && typeof parsed.peers === "object" ? { ...parsed.peers } : {},
    };
  } catch {
    return { version: 1, peers: {} };
  }
}

export function saveGatewayPeers(dir: string, data: GatewayPeersFile): void {
  const cfg = loadConfig(dir);
  const root = resolve(dir, cfg.stateDir);
  mkdirSync(root, { recursive: true });
  writeFileAtomic(peersPath(dir), JSON.stringify(data, null, 2) + "\n");
}

export function peerKey(adapter: string, chatId: string): string {
  return `${adapter}:${chatId}`;
}

export function gatewayPeerSessionIds(dir: string): string[] {
  return Object.values(loadGatewayPeers(dir).peers);
}
