import type { ActivityDetail } from "../host.js";

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
