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
