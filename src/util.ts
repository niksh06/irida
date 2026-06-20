import { randomUUID } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { iridaHome, iridaAllowProdStateWrite } from "./env.js";

/** True when running under the test runner (npm test / --test). */
export function isTestRun(): boolean {
  return (
    process.env.npm_lifecycle_event === "test" ||
    process.argv.includes("--test") ||
    process.execArgv.some((a) => a.includes("test"))
  );
}

/**
 * Block writes to CSAGENT_HOME/.agent during npm test (postmortem 2026-06-18
 * allowlist split-brain: test fixtures overwrote prod gateway state). Only
 * `cron.jobs.json` was guarded before — gateway.json/peers/pairing were not.
 * Set CSAGENT_ALLOW_PROD_STATE_WRITE=1 to override.
 */
export function guardProdStateWrite(stateRoot: string, label = "state"): void {
  const home = iridaHome();
  if (!home || !isTestRun()) return;
  if (iridaAllowProdStateWrite() === "1") return;
  if (resolve(stateRoot) === resolve(home, ".agent")) {
    throw new Error(
      `refusing to write ${label} under CSAGENT_HOME/.agent during npm test — use a temp directory`
    );
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function preview(text: string, max = 120): string {
  const s = (text ?? "").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Longer preview for assistant output stored for listing/replay (redacted by the store). */
export function resultPreview(text: string, max = 2000): string {
  return preview(text, max);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Write a state file via tmp + rename so a crash mid-write cannot corrupt it. */
export function writeFileAtomic(path: string, body: string, mode = 0o600): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, body, { encoding: "utf8", mode });
  renameSync(tmp, path);
}
