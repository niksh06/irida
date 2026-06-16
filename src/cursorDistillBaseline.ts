/**
 * Cursor distill baseline (I-65) — after backfill, weekly queue only sees archive delta.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { writeFileAtomic } from "./util.js";

export const CURSOR_DISTILL_BASELINE_FILE = "cursor-distill.baseline.json";

export interface CursorDistillBaseline {
  /** ISO timestamp — weekly distill only queues archives with updated_at strictly after this. */
  baselineAt: string;
  /** Optional note (e.g. backfill completed). */
  note?: string;
}

export function cursorDistillBaselinePath(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, CURSOR_DISTILL_BASELINE_FILE);
}

export function loadCursorDistillBaseline(dir: string): CursorDistillBaseline | undefined {
  const path = cursorDistillBaselinePath(dir);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CursorDistillBaseline>;
    if (typeof parsed.baselineAt !== "string" || !parsed.baselineAt.trim()) return undefined;
    const ms = Date.parse(parsed.baselineAt);
    if (!Number.isFinite(ms)) return undefined;
    return {
      baselineAt: parsed.baselineAt,
      note: typeof parsed.note === "string" ? parsed.note : undefined,
    };
  } catch {
    return undefined;
  }
}

export function baselineMs(baseline: CursorDistillBaseline | undefined): number | undefined {
  if (!baseline) return undefined;
  const ms = Date.parse(baseline.baselineAt);
  return Number.isFinite(ms) ? ms : undefined;
}

export function saveCursorDistillBaseline(
  dir: string,
  baselineAt: string,
  note?: string
): CursorDistillBaseline {
  const ms = Date.parse(baselineAt);
  if (!Number.isFinite(ms)) {
    throw new Error("baselineAt must be a valid ISO timestamp");
  }
  const record: CursorDistillBaseline = { baselineAt: new Date(ms).toISOString(), note };
  writeFileAtomic(cursorDistillBaselinePath(dir), JSON.stringify(record, null, 2) + "\n");
  return record;
}

/** Archive touched after baseline (delta mode). */
export function archiveIsDelta(updatedAtIso: string, baseline: CursorDistillBaseline | undefined): boolean {
  const bMs = baselineMs(baseline);
  if (bMs === undefined) return true;
  const uMs = Date.parse(updatedAtIso);
  if (!Number.isFinite(uMs)) return true;
  return uMs > bMs;
}
