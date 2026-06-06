/**
 * launchd: stdout → *.log, stderr → *.error.log — route info vs errors explicitly.
 */
import { redact } from "./redact.js";

export type ServiceLogLevel = "info" | "error";

export type ServiceLogSink = (line: string, level: ServiceLogLevel) => void;

export function emitServiceLog(
  line: string,
  level: ServiceLogLevel,
  sink?: ServiceLogSink
): void {
  const msg = redact(line);
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(`${msg}\n`);
  sink?.(msg, level);
}

/** Classify legacy single-arg log lines (gateway router default). */
export function inferServiceLogLevel(line: string): ServiceLogLevel {
  if (/\[gateway\] telegram poll error/i.test(line)) return "error";
  if (/\[chat\] sendTurn (failed|error)/i.test(line)) return "error";
  if (/\[gateway\] telegram chat=.*\berror:/i.test(line)) return "error";
  if (/^gateway: /i.test(line) && /\b(failed|error|unknown)\b/i.test(line)) return "error";
  return "info";
}

export function defaultServiceLogSink(line: string, level?: ServiceLogLevel): void {
  emitServiceLog(line, level ?? inferServiceLogLevel(line));
}
