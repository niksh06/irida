/**
 * Optional agent/chat diagnostics (stderr). Enable with CSAGENT_LOG=1.
 */
import { redact } from "./redact.js";

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
  /** Extra sink (tests, file hook). Called with the same redacted line (no timestamp). */
  onLog?: (line: string) => void;
}

/** Build a logger: stderr when CSAGENT_LOG; always forwards to onLog if set. */
export function resolveAgentLogger(opts: AgentLoggerOptions = {}): (line: string) => void {
  const component = opts.component ?? "csagent";
  const enabled = agentLogEnabled();
  return (line: string) => {
    const msg = redact(line);
    if (enabled) {
      const stamped = `[${component}] ${new Date().toISOString()} ${msg}`;
      process.stderr.write(`${stamped}\n`);
    }
    opts.onLog?.(msg);
  };
}
