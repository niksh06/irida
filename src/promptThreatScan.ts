/**
 * Shared injection-pattern scan for cron prompts and skill bodies (I-24, I-46).
 */
export const PROMPT_THREAT_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(your\s+)?(system|safety|rules)/i,
  /you\s+are\s+now\s+(in\s+)?(developer|admin|root)\s+mode/i,
  /\bDAN\b.*\bmode\b/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
  /print\s+(the\s+)?(full\s+)?system\s+prompt/i,
  /<\s*script\b/i,
  /\{\{\s*system\s*\}\}/i,
];

export function scanThreatPatterns(text: string): string[] {
  const hits: string[] = [];
  for (const re of PROMPT_THREAT_PATTERNS) {
    if (re.test(text)) hits.push(re.source);
  }
  return hits;
}
