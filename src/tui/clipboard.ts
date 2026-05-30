/** OSC 52 — copy text to system clipboard (best-effort; iTerm2, Ghostty, Cursor). */
export function osc52Copy(text: string): boolean {
  if (!process.stdout.isTTY || !text) return false;
  try {
    const b64 = Buffer.from(text, "utf8").toString("base64");
    process.stdout.write(`\x1b]52;c;${b64}\x07`);
    return true;
  } catch {
    return false;
  }
}

export function lastAssistantText(
  messages: Array<{ role: string; text: string }>
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "assistant" && m.text.trim()) return m.text;
  }
  return null;
}
