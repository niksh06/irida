/**
 * Decide the auth mode for an `/engine claude` switch (I-156).
 *
 * The old TUI pre-check hard-defaulted to api-key and refused when
 * ANTHROPIC_API_KEY was missing — even with an active `claude login` session
 * that account mode would have used. This resolves the mode from the explicit
 * hint, then config, then whatever credential actually exists, and only errors
 * when NO credential can serve the chosen mode. Pure — unit tested.
 */
export type ClaudeAuthDecision =
  | { ok: true; auth: "api-key" | "account"; note?: string }
  | { ok: false; error: string };

export function decideClaudeAuth(input: {
  /** Explicit `/engine claude <hint>` token, if any. */
  authHint?: string;
  /** --auth CLI override. */
  propsAuth?: string;
  /** engine.auth from config. */
  configAuth?: string;
  hasApiKey: boolean;
  hasAccount: boolean;
}): ClaudeAuthDecision {
  const { authHint, propsAuth, configAuth, hasApiKey, hasAccount } = input;
  const explicit = authHint === "account" || authHint === "api-key" ? authHint : undefined;

  let auth: "api-key" | "account" =
    explicit ??
    (propsAuth === "account" || propsAuth === "api-key" ? propsAuth : undefined) ??
    (configAuth === "account" || configAuth === "api-key" ? configAuth : undefined) ??
    (hasApiKey ? "api-key" : hasAccount ? "account" : "api-key");

  // Auto-fall to account when api-key mode has no key but a login does exist
  // (only when the user did NOT force a mode).
  if (auth === "api-key" && !hasApiKey && hasAccount && !explicit) {
    auth = "account";
  }
  // Explain an IMPLICIT account selection (user typed just `/engine claude`,
  // no api key) so it's obvious why account was chosen.
  const note =
    !explicit && auth === "account" && !hasApiKey
      ? "no ANTHROPIC_API_KEY — using account mode (claude login)"
      : undefined;

  if (auth === "api-key" && !hasApiKey) {
    return {
      ok: false,
      error:
        "claude needs a credential: set ANTHROPIC_API_KEY, or `/engine claude account` with an active `claude login`",
    };
  }
  if (auth === "account" && !hasAccount) {
    return {
      ok: false,
      error:
        "account mode needs `claude login` (or CLAUDE_CODE_OAUTH_TOKEN) — none found; set ANTHROPIC_API_KEY and use `/engine claude api-key`",
    };
  }
  return { ok: true, auth, ...(note ? { note } : {}) };
}
