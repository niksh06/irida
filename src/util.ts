import { randomUUID } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function preview(text: string, max = 120): string {
  const s = (text ?? "").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Longer preview for assistant output stored for listing/replay (redacted by the store). */
export function resultPreview(text: string, max = 2000): string {
  return preview(text, max);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Write a state file via tmp + rename so a crash mid-write cannot corrupt it. */
export function writeFileAtomic(path: string, body: string, mode = 0o600): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, body, { encoding: "utf8", mode });
  renameSync(tmp, path);
}
