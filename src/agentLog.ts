/**
 * Optional agent/chat diagnostics. Enable with CSAGENT_LOG=1.
 * Info → stdout, errors → stderr (launchd: gateway.log / gateway.error.log).
 */
import { redact } from "./redact.js";
import { emitServiceLog, inferServiceLogLevel, type ServiceLogLevel } from "./serviceLog.js";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function envTruthy(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return TRUTHY.has(v);
}

/** When true, chat/TUI/gateway callers emit timestamped lines to stderr. */
export function agentLogEnabled(): boolean {
  return envTruthy("CSAGENT_LOG") || envTruthy("CSAGENT_DEBUG");
}

/** Per-tool stream lines from chatEngine (very noisy). */
export function agentLogVerbose(): boolean {
  return envTruthy("CSAGENT_LOG_VERBOSE");
}

export interface AgentLoggerOptions {
  /** Prefix tag, e.g. `chat`, `tui`. */
  component?: string;
  /** Extra sink (tests, gateway). Receives redacted line + level. */
  onLog?: (line: string, level?: ServiceLogLevel) => void;
}

/** Build a logger: CSAGENT_LOG → stdout/stderr by level; always forwards to onLog. */
export function resolveAgentLogger(opts: AgentLoggerOptions = {}): (line: string) => void {
  const component = opts.component ?? "csagent";
  const enabled = agentLogEnabled();
  return (line: string) => {
    const msg = redact(line);
    const level = inferServiceLogLevel(msg);
    if (enabled) {
      const stamped = `[${component}] ${new Date().toISOString()} ${msg}`;
      emitServiceLog(stamped, level);
    }
    opts.onLog?.(msg, level);
  };
}
