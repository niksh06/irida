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
