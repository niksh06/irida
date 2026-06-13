/**
 * Persistent outbound queue for Telegram delivery (I-31).
 * A turn's reply or a cron digest that failed to send must survive process
 * restarts and network outages — at-least-once, with backoff and caps.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { newId, writeFileAtomic } from "./util.js";

import type { TelegramMessageFormat } from "./telegramFormat.js";

export const OUTBOX_FILE = "gateway.outbox.json";
export const OUTBOX_MAX_ENTRIES = 100;
export const OUTBOX_MAX_ATTEMPTS = 20;
export const OUTBOX_TTL_MS = 48 * 60 * 60 * 1000;
/** FAIL `gateway status` outbox row when oldest pending exceeds this (I-50). */
export const OUTBOX_STALE_MS = 5 * 60 * 1000;

/** Short plain ack when a reply is parked for retry (I-51). */
export const OUTBOX_PARK_ACK_TEXT = "Ответ готов, доставляю частями…";

export interface OutboxEntry {
  id: string;
  chatId: string;
  text: string;
  /** @deprecated use `format`. Kept for entries written before rich messages. */
  html?: boolean;
  /** rich = sendRichMessage markdown; html = sendMessage HTML; plain = no parse_mode. */
  format?: TelegramMessageFormat;
  /** Set after sendRichMessage/HTML fails (e.g. message too long) — retry as plain multipart. */
  degradedFormat?: TelegramMessageFormat;
  createdAt: string;
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
}

/** Resolve delivery format for an outbox row (backward compatible with `html`). */
export function resolveOutboxFormat(entry: OutboxEntry): TelegramMessageFormat {
  if (entry.format) return entry.format;
  if (entry.html === true) return "rich";
  return "plain";
}

export function isTelegramTooLongError(message: string): boolean {
  return /message is too long/i.test(message);
}

/** Delivery format for drain — auto-downgrade rich/html after too-long failures. */
export function resolveOutboxDeliveryFormat(entry: OutboxEntry): TelegramMessageFormat {
  if (entry.degradedFormat) return entry.degradedFormat;
  const base = resolveOutboxFormat(entry);
  if (base !== "plain" && entry.lastError && isTelegramTooLongError(entry.lastError)) {
    return "plain";
  }
  return base;
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

export interface OutboxStatusSummary {
  count: number;
  oldestAgeMs: number | null;
  nextRetryMs: number | null;
  stale: boolean;
}

export function summarizeOutbox(entries: OutboxEntry[], now: Date = new Date()): OutboxStatusSummary {
  if (entries.length === 0) {
    return { count: 0, oldestAgeMs: null, nextRetryMs: null, stale: false };
  }
  const nowMs = now.getTime();
  let oldestCreated = Number.POSITIVE_INFINITY;
  let earliestNext = Number.POSITIVE_INFINITY;
  for (const e of entries) {
    oldestCreated = Math.min(oldestCreated, Date.parse(e.createdAt));
    earliestNext = Math.min(earliestNext, Date.parse(e.nextAttemptAt));
  }
  const oldestAgeMs = nowMs - oldestCreated;
  const nextRetryMs = Math.max(0, earliestNext - nowMs);
  return {
    count: entries.length,
    oldestAgeMs,
    nextRetryMs,
    stale: oldestAgeMs > OUTBOX_STALE_MS,
  };
}

export function formatOutboxStatusDetail(summary: OutboxStatusSummary): string {
  if (summary.count === 0) return "empty";
  const ageMin = Math.floor((summary.oldestAgeMs ?? 0) / 60_000);
  const retryPart =
    summary.nextRetryMs === 0
      ? "retry due"
      : `next retry ~${Math.ceil((summary.nextRetryMs ?? 0) / 1000)}s`;
  return `${summary.count} pending · oldest ${ageMin}m · ${retryPart}`;
}

/** Health row for `gateway status` / `/status` (I-50). */
export function assessOutboxHealth(dir: string, now: Date = new Date()): { ok: boolean; detail: string } {
  const summary = summarizeOutbox(loadOutbox(dir).entries, now);
  if (summary.count === 0) return { ok: true, detail: "empty" };
  return { ok: !summary.stale, detail: formatOutboxStatusDetail(summary) };
}

/** Best-effort user ack after parking a reply (I-51). */
export async function sendOutboxParkAck(
  sendPlain: (text: string) => Promise<void>,
  log?: (line: string) => void,
  entryId?: string
): Promise<void> {
  const idTag = entryId ? ` id=${entryId}` : "";
  try {
    await sendPlain(OUTBOX_PARK_ACK_TEXT);
    log?.(`[gateway] outbox parked${idTag} ack sent`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log?.(`[gateway] outbox parked${idTag} ack failed: ${msg}`);
  }
}

/** Exponential backoff: 30s, 60s, 2m … capped at 1h. */
export function outboxBackoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3600_000);
}

const ENQUEUE_COMMIT_ATTEMPTS = 8;

function capOutboxEntries(entries: OutboxEntry[]): OutboxEntry[] {
  if (entries.length <= OUTBOX_MAX_ENTRIES) return entries;
  const sorted = [...entries].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return sorted.slice(sorted.length - OUTBOX_MAX_ENTRIES);
}

/**
 * Entries enqueued while drainOutbox was in flight (not in the load snapshot).
 * Without this merge, drain's save would overwrite concurrent enqueueOutbox writes.
 */
export function mergeOutboxAfterDrain(
  dir: string,
  snapshotIds: Set<string>,
  keep: OutboxEntry[]
): OutboxEntry[] {
  const current = loadOutbox(dir);
  const keepIds = new Set(keep.map((e) => e.id));
  const merged = [...keep];
  for (const entry of current.entries) {
    if (!snapshotIds.has(entry.id) && !keepIds.has(entry.id)) {
      merged.push(entry);
    }
  }
  return capOutboxEntries(merged);
}

export function enqueueOutbox(
  dir: string,
  input: { chatId: string; text: string; html?: boolean; format?: TelegramMessageFormat },
  now: Date = new Date()
): OutboxEntry {
  const format =
    input.format ?? (input.html === true ? "rich" : input.html === false ? "plain" : "plain");
  const entry: OutboxEntry = {
    id: newId("out"),
    chatId: input.chatId,
    text: input.text,
    format,
    html: format === "rich" || format === "html",
    createdAt: now.toISOString(),
    attempts: 0,
    nextAttemptAt: now.toISOString(),
  };
  for (let attempt = 0; attempt < ENQUEUE_COMMIT_ATTEMPTS; attempt++) {
    const data = loadOutbox(dir);
    if (data.entries.some((e) => e.id === entry.id)) return entry;

    const next = capOutboxEntries([...data.entries, entry]);
    saveOutbox(dir, { version: 1, entries: next });

    if (loadOutbox(dir).entries.some((e) => e.id === entry.id)) return entry;
  }
  throw new Error("outbox enqueue failed after concurrent writes");
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

  const snapshotIds = new Set(data.entries.map((e) => e.id));
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
      const errMsg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      const attempts = entry.attempts + 1;
      const next: OutboxEntry = {
        ...entry,
        attempts,
        nextAttemptAt: new Date(now.getTime() + outboxBackoffMs(attempts)).toISOString(),
        lastError: errMsg,
      };
      if (isTelegramTooLongError(errMsg) && resolveOutboxDeliveryFormat(entry) !== "plain") {
        next.degradedFormat = "plain";
      }
      keep.push(next);
    }
  }

  const persisted = mergeOutboxAfterDrain(dir, snapshotIds, keep);
  saveOutbox(dir, { version: 1, entries: persisted });
  return { sent, failed, dropped, remaining: persisted.length };
}
