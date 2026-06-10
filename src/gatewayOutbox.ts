/**
 * Persistent outbound queue for Telegram delivery (I-31).
 * A turn's reply or a cron digest that failed to send must survive process
 * restarts and network outages — at-least-once, with backoff and caps.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { newId, writeFileAtomic } from "./util.js";

export const OUTBOX_FILE = "gateway.outbox.json";
export const OUTBOX_MAX_ENTRIES = 100;
export const OUTBOX_MAX_ATTEMPTS = 20;
export const OUTBOX_TTL_MS = 48 * 60 * 60 * 1000;

export interface OutboxEntry {
  id: string;
  chatId: string;
  text: string;
  /** Send with HTML formatting helper (long message path). */
  html: boolean;
  createdAt: string;
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
}

export interface OutboxFile {
  version: number;
  entries: OutboxEntry[];
}

function outboxPath(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, OUTBOX_FILE);
}

export function loadOutbox(dir: string): OutboxFile {
  const path = outboxPath(dir);
  if (!existsSync(path)) return { version: 1, entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<OutboxFile>;
    return { version: 1, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

export function saveOutbox(dir: string, data: OutboxFile): void {
  const path = outboxPath(dir);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileAtomic(path, JSON.stringify(data, null, 2) + "\n");
}

/** Exponential backoff: 30s, 60s, 2m … capped at 1h. */
export function outboxBackoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3600_000);
}

export function enqueueOutbox(
  dir: string,
  input: { chatId: string; text: string; html?: boolean },
  now: Date = new Date()
): OutboxEntry {
  const data = loadOutbox(dir);
  const entry: OutboxEntry = {
    id: newId("out"),
    chatId: input.chatId,
    text: input.text,
    html: input.html ?? false,
    createdAt: now.toISOString(),
    attempts: 0,
    nextAttemptAt: now.toISOString(),
  };
  data.entries.push(entry);
  // Cap: drop oldest, never grow unbounded.
  if (data.entries.length > OUTBOX_MAX_ENTRIES) {
    data.entries.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    data.entries.splice(0, data.entries.length - OUTBOX_MAX_ENTRIES);
  }
  saveOutbox(dir, data);
  return entry;
}

export interface OutboxDrainResult {
  sent: number;
  failed: number;
  dropped: number;
  remaining: number;
}

/**
 * Try due entries once each. Success → remove; failure → backoff; entries past
 * attempt/TTL caps are dropped (logged by the caller via onDrop).
 */
export async function drainOutbox(
  dir: string,
  send: (entry: OutboxEntry) => Promise<void>,
  opts: { now?: Date; onDrop?: (entry: OutboxEntry) => void } = {}
): Promise<OutboxDrainResult> {
  const now = opts.now ?? new Date();
  const data = loadOutbox(dir);
  if (data.entries.length === 0) return { sent: 0, failed: 0, dropped: 0, remaining: 0 };

  const keep: OutboxEntry[] = [];
  let sent = 0;
  let failed = 0;
  let dropped = 0;

  for (const entry of data.entries) {
    const age = now.getTime() - Date.parse(entry.createdAt);
    if (entry.attempts >= OUTBOX_MAX_ATTEMPTS || age > OUTBOX_TTL_MS) {
      dropped++;
      opts.onDrop?.(entry);
      continue;
    }
    if (Date.parse(entry.nextAttemptAt) > now.getTime()) {
      keep.push(entry);
      continue;
    }
    try {
      await send(entry);
      sent++;
    } catch (e) {
      failed++;
      const attempts = entry.attempts + 1;
      keep.push({
        ...entry,
        attempts,
        nextAttemptAt: new Date(now.getTime() + outboxBackoffMs(attempts)).toISOString(),
        lastError: (e instanceof Error ? e.message : String(e)).slice(0, 300),
      });
    }
  }

  saveOutbox(dir, { version: 1, entries: keep });
  return { sent, failed, dropped, remaining: keep.length };
}
