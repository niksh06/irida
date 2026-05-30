/** Format tool commands for TUI (avoid multiline bleed into transcript). */

export function commandLineCount(command: string): number {
  if (!command) return 0;
  return command.split("\n").length;
}

/** Single-line preview for activity bar (never dump full heredocs). */
export function summarizeCommandForBar(command: string, maxLen = 76): string {
  const one = command.replace(/\s+/g, " ").trim();
  const lines = commandLineCount(command);
  if (lines > 1) {
    const head = one.slice(0, Math.max(20, maxLen - 16)).trimEnd();
    return `${head}… (${lines} lines)`;
  }
  if (one.length <= maxLen) return one;
  return `${one.slice(0, maxLen - 1)}…`;
}

/** Banner body: cap lines so heredocs don't flood the transcript pane. */
export function truncateCommandForBanner(
  command: string,
  maxLines = 8
): { text: string; truncated: boolean; totalLines: number } {
  const lines = command.split("\n");
  const totalLines = lines.length;
  if (totalLines <= maxLines) {
    return { text: command, truncated: false, totalLines };
  }
  const kept = lines.slice(0, maxLines).join("\n");
  return {
    text: `${kept}\n… (${totalLines - maxLines} more lines · /tools for history)`,
    truncated: true,
    totalLines,
  };
}

/** Compact tool counter label for activity strip. */
export function toolEventCounterLabel(count: number): string | null {
  if (count <= 1) return null;
  return `${count} tool events · /tools`;
}
