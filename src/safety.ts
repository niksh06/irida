/**
 * Safety baseline (issue 006). Redaction lives in redact.ts; here we gate
 * destructive prompts before any SDK run. Interactive callers must confirm;
 * non-interactive callers are denied.
 */
export interface SafetyDecision {
  allowed: boolean;
  reason: string;
  destructive: boolean;
}

const DESTRUCTIVE: RegExp[] = [
  /\brm\s+-[a-z]*r[a-z]*f?\b/i, // rm -rf
  /\brm\s+-[a-z]*f[a-z]*r?\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bdrop\s+(table|database|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\bmkfs\b|\bformat\s+[a-z]:/i,
  /\bdd\s+if=.*of=\/dev\//i,
  /\b(delete|wipe|erase|destroy)\b.*\b(all|everything|database|repo|disk|volume)\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\}/, // fork bomb
];

export function isDestructive(prompt: string): boolean {
  return DESTRUCTIVE.some((re) => re.test(prompt));
}

export type Confirmer = (reason: string) => Promise<boolean>;

/**
 * Decide whether a prompt may proceed.
 *  - non-destructive -> allowed.
 *  - destructive + interactive -> ask `confirm`.
 *  - destructive + non-interactive -> denied.
 */
export async function safetyGate(args: {
  prompt: string;
  interactive: boolean;
  confirm?: Confirmer;
}): Promise<SafetyDecision> {
  if (!isDestructive(args.prompt)) {
    return { allowed: true, reason: "ok", destructive: false };
  }
  const reason = "prompt requests a potentially destructive action";
  if (!args.interactive || !args.confirm) {
    return { allowed: false, reason: `${reason} (denied: non-interactive)`, destructive: true };
  }
  const ok = await args.confirm(reason);
  return {
    allowed: ok,
    reason: ok ? "confirmed by user" : "declined by user",
    destructive: true,
  };
}
