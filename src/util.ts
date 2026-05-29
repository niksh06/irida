import { randomUUID } from "node:crypto";

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
