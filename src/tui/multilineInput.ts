/** Multiline text cursor helpers for TUI composer. */

export function clampCursor(value: string, pos: number): number {
  return Math.max(0, Math.min(pos, value.length));
}

export function cursorLineCol(value: string, pos: number): { line: number; col: number } {
  const p = clampCursor(value, pos);
  const before = value.slice(0, p);
  const line = (before.match(/\n/g) ?? []).length;
  const lastNl = before.lastIndexOf("\n");
  const col = p - (lastNl + 1);
  return { line, col };
}

export function lineColToCursor(value: string, line: number, col: number): number {
  const lines = value.split("\n");
  const ln = Math.max(0, Math.min(line, Math.max(0, lines.length - 1)));
  const lineText = lines[ln] ?? "";
  const c = Math.max(0, Math.min(col, lineText.length));
  let pos = 0;
  for (let i = 0; i < ln; i++) pos += (lines[i]?.length ?? 0) + 1;
  return pos + c;
}

export function insertAt(
  value: string,
  pos: number,
  text: string
): { value: string; cursor: number } {
  const p = clampCursor(value, pos);
  const next = value.slice(0, p) + text + value.slice(p);
  return { value: next, cursor: p + text.length };
}

export function deleteBefore(value: string, pos: number): { value: string; cursor: number } {
  return eraseBeforeCursor(value, pos);
}

export function eraseBeforeCursor(value: string, pos: number): { value: string; cursor: number } {
  const p = clampCursor(value, pos);
  if (p === 0) return { value, cursor: 0 };
  return { value: value.slice(0, p - 1) + value.slice(p), cursor: p - 1 };
}

export function deleteForward(value: string, pos: number): { value: string; cursor: number } {
  const p = clampCursor(value, pos);
  if (p >= value.length) return { value, cursor: p };
  return { value: value.slice(0, p) + value.slice(p + 1), cursor: p };
}

export function moveCursor(
  value: string,
  pos: number,
  dir: "left" | "right" | "up" | "down"
): number {
  const p = clampCursor(value, pos);
  if (dir === "left") return Math.max(0, p - 1);
  if (dir === "right") return Math.min(value.length, p + 1);

  const { line, col } = cursorLineCol(value, p);
  const lines = value.split("\n");
  if (dir === "up") {
    if (line === 0) return 0;
    return lineColToCursor(value, line - 1, col);
  }
  if (line >= lines.length - 1) return value.length;
  return lineColToCursor(value, line + 1, col);
}

/** Visible window for long multiline drafts. */
export function visibleComposerLines(
  value: string,
  cursor: number,
  maxLines: number
): { lines: string[]; startLine: number; cursorLine: number; cursorCol: number; hiddenAbove: number } {
  const all = value.length === 0 ? [""] : value.split("\n");
  const { line: cursorLine, col: cursorCol } = cursorLineCol(value, cursor);
  const startLine =
    all.length <= maxLines ? 0 : Math.max(0, Math.min(cursorLine - maxLines + 1, all.length - maxLines));
  const end = Math.min(all.length, startLine + maxLines);
  return {
    lines: all.slice(startLine, end),
    startLine,
    cursorLine: cursorLine - startLine,
    cursorCol,
    hiddenAbove: startLine,
  };
}
