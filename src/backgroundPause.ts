/**
 * Background activity pause switch — "only my-side initiation" mode.
 *
 * When paused, `cron tick` runs no jobs, so nothing autonomous spends tokens;
 * user-initiated paths (TUI, gateway replies, `cron run <id>`) are unaffected.
 *
 * State lives in <stateDir>/background-pause.json so a separate cron-tick
 * process sees a pause toggled from the long-running gateway (they share
 * CSAGENT_HOME). The env var CSAGENT_PAUSE_BACKGROUND=1 is a hard override that
 * wins over the file — handy to neuter launchd jobs before a deploy ships the
 * file-based toggle.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { backgroundPauseEnv } from "./env.js";
import { guardProdStateWrite, writeFileAtomic } from "./util.js";

const PAUSE_FILE = "background-pause.json";

export interface BackgroundPauseState {
  paused: boolean;
  reason?: string;
  /** ISO timestamp the file flag was last set. */
  at?: string;
  /** Where the effective state came from. */
  source: "env" | "file" | "none";
}

function stateRoot(dir: string): string {
  return resolve(dir, loadConfig(dir).stateDir);
}

function envPaused(): boolean {
  const v = backgroundPauseEnv()?.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Effective pause state: env override wins, then the on-disk flag. */
export function backgroundPauseState(dir: string): BackgroundPauseState {
  if (envPaused()) {
    return { paused: true, source: "env", reason: "CSAGENT_PAUSE_BACKGROUND" };
  }
  const path = resolve(stateRoot(dir), PAUSE_FILE);
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<BackgroundPauseState>;
      if (raw?.paused) {
        return { paused: true, source: "file", reason: raw.reason, at: raw.at };
      }
    } catch {
      // Corrupt flag → treat as not paused; status will show the parse via re-read.
    }
  }
  return { paused: false, source: "none" };
}

export function isBackgroundPaused(dir: string): boolean {
  return backgroundPauseState(dir).paused;
}

/** Persist the file flag. Note: an env override still forces paused regardless. */
export function setBackgroundPaused(
  dir: string,
  paused: boolean,
  reason?: string,
  at: string = new Date().toISOString()
): BackgroundPauseState {
  const root = stateRoot(dir);
  guardProdStateWrite(root, "background-pause");
  mkdirSync(root, { recursive: true });
  const trimmed = reason?.trim() || undefined;
  const body = JSON.stringify({ paused, reason: trimmed, at }, null, 2) + "\n";
  writeFileAtomic(resolve(root, PAUSE_FILE), body);
  return backgroundPauseState(dir);
}
