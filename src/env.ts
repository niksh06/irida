/**
 * Resolved csagent environment accessors (Arch-4 — the single env read layer).
 *
 * Goal: nothing outside this module (and the DB-specific pg/pool.ts) reads
 * `process.env.CSAGENT_*` directly, so every knob is discoverable in one place
 * and tests have one seam to control. Each accessor trims and normalizes the
 * empty string to `undefined`. This is a leaf module — it imports nothing.
 */

function readTrimmed(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** Prod home dir (e.g. ~/.csagent), or undefined when unset. */
export function csagentHome(): string | undefined {
  return readTrimmed("CSAGENT_HOME");
}

/**
 * Install root of the agent (e.g. ~/.csagent/csagent) — the second candidate
 * for resolving skills/prompts/scripts when launched outside the project dir.
 */
export function csagentRoot(): string | undefined {
  return readTrimmed("CSAGENT_ROOT");
}

/** Override for the project dir MCP child tools resolve memory/cron against. */
export function csagentMemoryDir(): string | undefined {
  return readTrimmed("CSAGENT_MEMORY_DIR");
}

/** Override for the state dir (.agent) MCP child tools resolve against. */
export function csagentStateDir(): string | undefined {
  return readTrimmed("CSAGENT_STATE_DIR");
}

/** Knowledge-base root for `memory kb` import/export. */
export function csagentKbRoot(): string | undefined {
  return readTrimmed("CSAGENT_KB_ROOT");
}

/**
 * Hard override that pauses all background/cron activity (truthy = paused).
 * Wins over the on-disk pause flag, so launchd jobs can be neutered via env
 * even before a deploy carries the file-based toggle. See backgroundPause.ts.
 */
export function backgroundPauseEnv(): string | undefined {
  return readTrimmed("CSAGENT_PAUSE_BACKGROUND");
}

// --- diagnostics / logging toggles (callers interpret "0"/"1") ---

/** Action transcript logging — enabled unless set to "0". */
export function csagentActionLog(): string | undefined {
  return readTrimmed("CSAGENT_ACTION_LOG");
}

/** Run logging — enabled unless set to "0". */
export function csagentRunLog(): string | undefined {
  return readTrimmed("CSAGENT_RUN_LOG");
}

/** Idle-refresh interval in ms ("0" disables); caller parses the number. */
export function csagentAgentIdleMs(): string | undefined {
  return readTrimmed("CSAGENT_AGENT_IDLE_MS");
}

/** Explicit env-file path, highest precedence in loadCsagentEnv. */
export function csagentEnvFile(): string | undefined {
  return readTrimmed("CSAGENT_ENV");
}

/** Use the alternate TUI screen buffer when "1". */
export function csagentTuiAlt(): string | undefined {
  return readTrimmed("CSAGENT_TUI_ALT");
}

/** Comma-separated model picker override; caller splits. */
export function csagentModels(): string | undefined {
  return readTrimmed("CSAGENT_MODELS");
}

/** Escape hatch to allow writes under CSAGENT_HOME/.agent during tests. */
export function csagentAllowProdStateWrite(): string | undefined {
  return readTrimmed("CSAGENT_ALLOW_PROD_STATE_WRITE");
}

// --- gateway child-process context (passed to MCP tool subprocesses) ---

export function csagentGatewayChatId(): string | undefined {
  return readTrimmed("CSAGENT_GATEWAY_CHAT_ID");
}

export function csagentGatewayAdapter(): string | undefined {
  return readTrimmed("CSAGENT_GATEWAY_ADAPTER");
}

// --- browser MCP / chromium launch ---

export function csagentBrowserRoot(): string | undefined {
  return readTrimmed("CSAGENT_BROWSER_ROOT");
}

export function csagentBrowserProfile(): string | undefined {
  return readTrimmed("CSAGENT_BROWSER_PROFILE");
}

export function csagentBrowserHeadless(): string | undefined {
  return readTrimmed("CSAGENT_BROWSER_HEADLESS");
}

export function csagentBrowserNoSandbox(): string | undefined {
  return readTrimmed("CSAGENT_BROWSER_NO_SANDBOX");
}

export function csagentBrowserInsecureTls(): string | undefined {
  return readTrimmed("CSAGENT_BROWSER_INSECURE_TLS");
}

export function csagentChromePath(): string | undefined {
  return readTrimmed("CSAGENT_CHROME_PATH");
}
