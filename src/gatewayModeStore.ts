/**
 * Per-chat turn mode persistence (I-91). A chat can pick a sticky mode via the
 * `/mode` slash; subsequent messages without an explicit ADVICE:/DO:/… prefix
 * inherit it. Stored in `<stateDir>/gateway.modes.json`, keyed by peerKey
 * (adapter:chatId), modeled on gatewayPeers. An explicit message prefix always
 * wins over the stored mode; the stored mode wins over the IRIDA_MODE env.
 */
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { writeFileAtomic } from "./util.js";
import { peerKey } from "./gatewayPeers.js";
import { hasModePrefix, type TurnMode } from "./preTurn.js";

export const GATEWAY_MODES_FILE = "gateway.modes.json";

export interface GatewayModesFile {
  version: number;
  /** peerKey (adapter:chatId) → mode */
  modes: Record<string, TurnMode>;
}

function modesPath(dir: string): string {
  return resolve(dir, loadConfig(dir).stateDir, GATEWAY_MODES_FILE);
}

export function loadGatewayModes(dir: string): GatewayModesFile {
  const p = modesPath(dir);
  if (!existsSync(p)) return { version: 1, modes: {} };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return { version: 1, modes: parsed.modes && typeof parsed.modes === "object" ? parsed.modes : {} };
  } catch {
    return { version: 1, modes: {} };
  }
}

export function saveGatewayModes(dir: string, data: GatewayModesFile): void {
  const p = modesPath(dir);
  mkdirSync(resolve(p, ".."), { recursive: true });
  writeFileAtomic(p, JSON.stringify({ version: 1, modes: data.modes }, null, 2) + "\n");
}

export function getChatMode(dir: string, adapter: string, chatId: string): TurnMode | undefined {
  return loadGatewayModes(dir).modes[peerKey(adapter, chatId)];
}

export function setChatMode(dir: string, adapter: string, chatId: string, mode: TurnMode): void {
  const file = loadGatewayModes(dir);
  file.modes[peerKey(adapter, chatId)] = mode;
  saveGatewayModes(dir, file);
}

/** Clear a chat's sticky mode. Returns true if one was set. */
export function clearChatMode(dir: string, adapter: string, chatId: string): boolean {
  const file = loadGatewayModes(dir);
  const key = peerKey(adapter, chatId);
  if (!(key in file.modes)) return false;
  delete file.modes[key];
  saveGatewayModes(dir, file);
  return true;
}

/**
 * Apply a chat's sticky mode to an outgoing turn: prepend the mode prefix unless
 * the message already carries an explicit one (which always wins). Pure.
 */
export function applyChatModePrefix(text: string, mode: TurnMode | undefined): string {
  if (!mode || hasModePrefix(text)) return text;
  return `${mode.toUpperCase()}: ${text}`;
}
