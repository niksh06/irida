/**
 * Safety baseline (issue 006). Redaction lives in redact.ts; here we gate
 * destructive prompts before any SDK run.
 *
 * LIMITATION (honest): detection is a best-effort regex denylist, NOT a real
 * sandbox or guardrail. It catches common destructive shapes (`rm -rf`, `drop
 * table`, force-push, fork bombs) but is trivially bypassed by obfuscation or
 * by the agent's own tool actions inside the Cursor runtime. Treat it as a
 * speed-bump, not a security boundary.
 *
 * Policy:
 *  - non-destructive            -> allowed.
 *  - destructive + interactive  -> ask the user to confirm.
 *  - destructive + non-interactive + override (--yes-i-understand) -> allowed.
 *  - destructive + non-interactive (no override) -> denied.
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

/**
 * First destructive-pattern match in `text`, returned as a short reason — or null
 * when clean. Same denylist as the prompt gate, reused by the claude-agent
 * tool-deny gate (I-94) to vet runtime tool inputs (a Bash command the agent
 * chose), not just the user prompt. Patterns are non-global, so `.exec` is safe.
 */
export function destructiveReason(text: string): string | null {
  for (const re of DESTRUCTIVE) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

export type Confirmer = (reason: string) => Promise<boolean>;

export async function safetyGate(args: {
  prompt: string;
  interactive: boolean;
  confirm?: Confirmer;
  /** Explicit non-interactive override (--yes-i-understand). */
  override?: boolean;
}): Promise<SafetyDecision> {
  if (!isDestructive(args.prompt)) {
    return { allowed: true, reason: "ok", destructive: false };
  }
  const reason = "prompt requests a potentially destructive action";
  if (args.override) {
    return { allowed: true, reason: `${reason} (overridden by --yes-i-understand)`, destructive: true };
  }
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
