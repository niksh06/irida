import { randomUUID } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function preview(text: string, max = 120): string {
  const s = (text ?? "").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function nowIso(): string {
  return new Date().toISOString();
}
