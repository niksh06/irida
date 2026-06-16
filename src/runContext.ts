/**
 * Run log metadata (I-68): channel, cron job, test detection — jsonl only, not DB columns.
 */
import { basename, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import type { RunRecord } from "./store.js";
import { SESSION_CHANNEL } from "./sessionChannel.js";

export type RunLogChannel =
  | typeof SESSION_CHANNEL.telegram
  | typeof SESSION_CHANNEL.webhook
  | typeof SESSION_CHANNEL.tui
  | typeof SESSION_CHANNEL.cli
  | typeof SESSION_CHANNEL.cron
  | typeof SESSION_CHANNEL.run
  | "unknown";

const TEST_TEMP_DIR_RE =
  /^(rotate-fail|chat-|session-ingest|metrics-|gateway-|cron-|memory-|store-|rotate-|csagent-)/;

/** npm test / explicit test env — shared with cron prod-state guard. */
export function isNpmTestProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.npm_lifecycle_event === "test" ||
    process.argv.includes("--test") ||
    process.execArgv.some((a) => a.includes("test"))
  );
}

/** Heuristic: temp cwd or test harness — filters introspection / run log prod metrics. */
export function inferIsTestRun(cwd: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CSAGENT_TEST === "1") return true;
  const resolved = resolve(cwd);
  const tmpRoot = resolve(tmpdir());
  if (!resolved.startsWith(tmpRoot + sep) && resolved !== tmpRoot) return false;
  const base = basename(resolved);
  return TEST_TEMP_DIR_RE.test(base) || (isNpmTestProcess(env) && base.length <= 12);
}

export function normalizeRunLogChannel(channel: string | undefined): RunLogChannel {
  const ch = channel?.trim() ?? "";
  switch (ch) {
    case SESSION_CHANNEL.telegram:
    case SESSION_CHANNEL.webhook:
    case SESSION_CHANNEL.tui:
    case SESSION_CHANNEL.cli:
    case SESSION_CHANNEL.cron:
    case SESSION_CHANNEL.run:
      return ch;
    default:
      return ch ? "unknown" : "unknown";
  }
}

export interface RunLogMetaInput {
  /** Session channel (telegram, cron, cli, …). */
  channel?: string;
  cronJob?: string;
  cwd: string;
}

export type RunLogMeta = Pick<RunRecord, "channel" | "cron_job" | "is_test">;

export function buildRunLogMeta(input: RunLogMetaInput): RunLogMeta {
  const channel = normalizeRunLogChannel(input.channel);
  const cronJob = input.cronJob?.trim() || null;
  return {
    channel,
    cron_job: cronJob,
    is_test: inferIsTestRun(input.cwd),
  };
}
