import { redact } from "./redact.js";

const MAX_ERROR_DETAIL = 512;

/** Persistable run error detail (redacted, length-capped). */
export function formatErrorDetail(parts: Array<string | null | undefined>): string | null {
  const text = parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" · ");
  if (!text) return null;
  return redact(text.slice(0, MAX_ERROR_DETAIL));
}
