/**
 * Secret redaction for anything that may reach logs / stdout.
 * Baseline only — the full safety/redaction policy lands in issue 006.
 */
const PATTERNS: RegExp[] = [
  /(CURSOR_API_KEY\s*[=:]\s*)\S+/gi,
  /\bkey[_-][A-Za-z0-9]{6,}\b/gi, // Cursor-style key_... tokens
  /(Bearer\s+)[A-Za-z0-9._-]{8,}/gi,
  /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, // telegram-bot-token shape
];

export function redact(input: string): string {
  if (!input) return input;
  let out = input;
  for (const re of PATTERNS) {
    out = out.replace(re, (m, p1?: string) => (p1 ? `${p1}<redacted>` : "<redacted>"));
  }
  return out;
}
