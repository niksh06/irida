/**
 * In-flight Telegram update journal (I-138 / audit H-3).
 *
 * The poll loop used to ack (advance the getUpdates offset) only AFTER an
 * update was fully handled — crash-safe, but head-of-line blocking: one slow
 * turn stalled polling, every other chat, and outbox drain. Updates are now
 * journaled here BEFORE the offset advances and removed once handled; gateway
 * startup replays survivors. Same at-least-once guarantee, no serial ack.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { writeFileAtomic } from "./util.js";

export const GATEWAY_INFLIGHT_FILE = "gateway.inflight.json";
/** Defensive cap — a runaway backlog drops oldest instead of growing unbounded. */
export const INFLIGHT_MAX_ENTRIES = 200;

export interface InflightEntry {
  updateId: number;
  chatId: string;
  /** Raw Telegram update, replayed verbatim on startup. */
  update: unknown;
  at: string;
}

interface InflightFile {
  version: 1;
  entries: InflightEntry[];
}

function inflightPath(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, GATEWAY_INFLIGHT_FILE);
}

export function loadInflight(dir: string): InflightEntry[] {
  const path = inflightPath(dir);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<InflightFile>;
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(
      (e): e is InflightEntry =>
        e != null &&
        typeof e === "object" &&
        typeof (e as InflightEntry).updateId === "number" &&
        typeof (e as InflightEntry).chatId === "string"
    );
  } catch {
    // Corrupt journal — losing the replay beats crashing the gateway.
    return [];
  }
}

function saveInflight(dir: string, entries: InflightEntry[]): void {
  const path = inflightPath(dir);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileAtomic(path, JSON.stringify({ version: 1, entries }, null, 2) + "\n");
}

export function addInflight(dir: string, entry: InflightEntry): void {
  const entries = loadInflight(dir).filter((e) => e.updateId !== entry.updateId);
  entries.push(entry);
  // Oldest first out — updateId is monotonic within a bot.
  entries.sort((a, b) => a.updateId - b.updateId);
  while (entries.length > INFLIGHT_MAX_ENTRIES) entries.shift();
  saveInflight(dir, entries);
}

export function removeInflight(dir: string, updateId: number): void {
  const entries = loadInflight(dir);
  const next = entries.filter((e) => e.updateId !== updateId);
  if (next.length === entries.length) return;
  saveInflight(dir, next);
}
