/**
 * Persist Telegram getUpdates offset across gateway restarts.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";

export const GATEWAY_TELEGRAM_OFFSET_FILE = "gateway.telegram.offset";

export function gatewayTelegramOffsetPath(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, GATEWAY_TELEGRAM_OFFSET_FILE);
}

export function loadTelegramPollOffset(dir: string): number {
  const path = gatewayTelegramOffsetPath(dir);
  if (!existsSync(path)) return 0;
  try {
    const raw = readFileSync(path, "utf8").trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveTelegramPollOffset(dir: string, offset: number): void {
  if (!Number.isFinite(offset) || offset < 0) return;
  const path = gatewayTelegramOffsetPath(dir);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, String(offset), "utf8");
}
