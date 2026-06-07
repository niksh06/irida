/**
 * Pending user cron jobs awaiting /schedule approve (chat confirm flow).
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import type { CronJob } from "./cronJobs.js";

export const CRON_SCHEDULE_PENDING_FILE = "cron.schedule.pending.json";

export interface CronSchedulePendingEntry {
  code: string;
  chatId: string;
  adapter: string;
  job: CronJob;
  createdAt: string;
}

export interface CronSchedulePendingFile {
  version: number;
  pending: CronSchedulePendingEntry[];
}

function pendingPath(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, CRON_SCHEDULE_PENDING_FILE);
}

export function loadCronSchedulePending(dir: string): CronSchedulePendingFile {
  const path = pendingPath(dir);
  if (!existsSync(path)) return { version: 1, pending: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CronSchedulePendingFile;
    return {
      version: 1,
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
    };
  } catch {
    return { version: 1, pending: [] };
  }
}

export function saveCronSchedulePending(dir: string, data: CronSchedulePendingFile): void {
  const path = pendingPath(dir);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}

export function newScheduleCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}
