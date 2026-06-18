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

// Patterns where only the secret group (p2) is masked, keeping surrounding
// context (scheme/userinfo) readable. pg driver errors embed full DSNs.
const GROUPED_PATTERNS: RegExp[] = [
  // scheme://user:<password>@host — DB/redis/amqp connection strings
  /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|rediss):\/\/[^:/\s@]+:)([^@\s]+)(@)/gi,
  // key=value / "password": "..." style secret assignments
  /\b(password|passwd|pwd|secret|token)(["']?\s*[=:]\s*["']?)([^\s"',}]+)/gi,
];

export function redact(input: string): string {
  if (!input) return input;
  let out = input;
  for (const re of PATTERNS) {
    out = out.replace(re, (m, p1?: string) => (p1 ? `${p1}<redacted>` : "<redacted>"));
  }
  out = out.replace(GROUPED_PATTERNS[0]!, (_m, pre: string, _secret: string, post: string) => `${pre}<redacted>${post}`);
  out = out.replace(GROUPED_PATTERNS[1]!, (_m, key: string, sep: string) => `${key}${sep}<redacted>`);
  return out;
}
