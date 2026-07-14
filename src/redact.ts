/**
 * Secret redaction for anything that may reach logs / stdout.
 * Baseline only — the full safety/redaction policy lands in issue 006.
 */
const PATTERNS: RegExp[] = [
  /(CURSOR_API_KEY\s*[=:]\s*)\S+/gi,
  /\bkey[_-][A-Za-z0-9]{6,}\b/gi, // Cursor-style key_... tokens
  /(Bearer\s+)[A-Za-z0-9._-]{8,}/gi,
  /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, // telegram-bot-token shape
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // Anthropic sk-ant-… and generic sk-… API keys (I-142)
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/gi, // Stripe secret keys (I-162)
  /\bxox[bpsr]-[A-Za-z0-9-]{10,}\b/gi, // Slack tokens (I-162)
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id (I-162)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, // SSH/PEM private key blocks (I-162)
];

// Patterns where only the secret group (p2) is masked, keeping surrounding
// context (scheme/userinfo) readable. pg driver errors embed full DSNs.
const GROUPED_PATTERNS: RegExp[] = [
  // scheme://user:<password>@host — DB/redis/amqp connection strings
  /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|rediss):\/\/[^:/\s@]+:)([^@\s]+)(@)/gi,
  // key=value / "password": "..." style secret assignments. Matches the whole
  // identifier (not just the bare keyword) so SNAKE_CASE env vars like
  // DB_PASSWORD / IRIDA_SECRETS_KEY / AWS_ACCESS_KEY_ID / GITHUB_TOKEN are
  // caught too — \b doesn't break on `_`, so a bare keyword-only pattern
  // misses any prefixed/suffixed identifier (I-162 finding: transcripts
  // routinely dump `env`/`.env` output using exactly this naming style).
  /\b((?:[A-Za-z0-9]+_)*(?:password|passwd|pwd|secret|token|key|credential)s?(?:_[A-Za-z0-9]+)*)(["']?\s*[=:]\s*["']?)([^\s"',}]+)/gi,
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
