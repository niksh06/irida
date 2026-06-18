import type { ActivityDetail } from "../host.js";

/** Only real tool/MCP calls belong in the assistant bubble — not synthetic “thinking…”. */
export function shouldInjectToolProgressIntoStream(entry: ActivityDetail): boolean {
  return entry.phase === "call" && (entry.kind === "tool" || entry.kind === "mcp");
}

/** Placeholder injected before the model streams (I-10); strip when real text arrives. */
export function isStreamToolProgressPlaceholder(text: string): boolean {
  const line = text.trim();
  if (!line.startsWith("⚙ ")) return false;
  return !line.includes("\n");
}

/** One-line tool progress for the assistant strip (issue I-10). */
export function formatToolProgressLine(entry: ActivityDetail): string {
  if (entry.phase !== "call") return "";
  const name = entry.toolName?.trim() || entry.label?.trim() || "tool";
  const cmd = entry.command?.trim();
  if (cmd) {
    const short = cmd.length > 72 ? `${cmd.slice(0, 69)}…` : cmd;
    return `⚙ ${name}: ${short}`;
  }
  return `⚙ ${name}…`;
}
