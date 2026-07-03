import stringWidth from "string-width";
import type { RunRecord } from "../store.js";
import type { ChatMessage, MessageRole } from "./types.js";
import { renderMarkdown, type MdSegment } from "./markdown.js";

let histSeq = 0;
function histId(role: string): string {
  return `hist-${role}-${++histSeq}`;
}

/** Hydrate TUI transcript from stored runs (redacted previews only). */
export function runsToMessages(runs: RunRecord[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const r of runs) {
    if (r.prompt_preview) {
      out.push({ id: histId("user"), role: "user", text: r.prompt_preview });
    }
    if (r.result_preview) {
      out.push({ id: histId("assistant"), role: "assistant", text: r.result_preview });
    }
  }
  return out;
}

export interface TranscriptRow {
  key: string;
  role: MessageRole;
  /** Plain projection of the line — used for search, copy, and measurement. */
  text: string;
  /** Rich markdown segments (assistant lines) — renderer falls back to `text`. */
  segments?: MdSegment[];
  showRole: boolean;
  showSep: boolean;
  streaming?: boolean;
}

export interface TranscriptViewport {
  visible: TranscriptRow[];
  hiddenAbove: number;
  hiddenBelow: number;
  atBottom: boolean;
  totalLines: number;
}

/**
 * Word-wrap plain text to the transcript column, measured by DISPLAY WIDTH
 * (I-156b): the old code cut by code-point count, so emoji / CJK (2 cells each)
 * overflowed the terminal by up to 2× and drifted the layout. We accumulate
 * display cells per line, break on the last space that fits, and hard-split
 * any single token wider than the budget (a wall of emoji with no spaces).
 */
export function wrapToWidth(text: string, width: number): string[] {
  const max = Math.max(16, width - 8);
  if (!text) return [""];
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      out.push("");
      continue;
    }
    let line = "";
    let lineW = 0;
    const flush = () => {
      out.push(line.replace(/\s+$/, ""));
      line = "";
      lineW = 0;
    };
    // Split into words but keep the trailing spaces so wrapping stays natural;
    // words themselves may still exceed the budget and get hard-split below.
    for (const word of paragraph.match(/\s+|\S+/g) ?? []) {
      const isSpace = /^\s+$/.test(word);
      let w = word;
      // Leading whitespace at the start of a fresh line is dropped.
      if (isSpace && lineW === 0) continue;
      let wl = stringWidth(w);
      if (lineW + wl <= max) {
        line += w;
        lineW += wl;
        continue;
      }
      // A space that doesn't fit just ends the line.
      if (isSpace) {
        flush();
        continue;
      }
      // A whole word that doesn't fit: break the current line first (unless the
      // word is itself wider than the budget — then hard-split it across lines).
      if (lineW > 0 && wl <= max) {
        flush();
        line = w;
        lineW = wl;
        continue;
      }
      // Hard-split an over-long token by display cells.
      for (const ch of w) {
        const cw = stringWidth(ch);
        if (lineW + cw > max && lineW > 0) flush();
        line += ch;
        lineW += cw;
      }
      void wl;
    }
    flush();
  }
  return out.length ? out : [""];
}

export type MessageRowCache = Map<
  string,
  {
    text: string;
    width: number;
    rows: Array<Omit<TranscriptRow, "key" | "streaming">>;
  }
>;

/** Lines for one message: markdown-rendered for assistant, plain otherwise. */
function messageLines(
  role: MessageRole,
  text: string,
  width: number
): Array<{ text: string; segments?: MdSegment[] }> {
  if (role === "assistant") {
    return renderMarkdown(text, width).map((l) => ({ text: l.plain, segments: l.segments }));
  }
  return wrapToWidth(text, width).map((line) => ({ text: line }));
}

export function messagesToRows(messages: ChatMessage[], width: number): TranscriptRow[] {
  const cache: MessageRowCache = new Map();
  return messagesToRowsCached(messages, width, cache);
}

/** Re-wrap only messages whose text or width changed (streaming perf). */
export function messagesToRowsCached(
  messages: ChatMessage[],
  width: number,
  cache: MessageRowCache
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const liveIds = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    liveIds.add(m.id);
    const showSep = m.role === "user" && i > 0 && messages[i - 1]?.role !== "system";
    const cached = cache.get(m.id);
    let msgRows: TranscriptRow[];

    if (cached && cached.text === m.text && cached.width === width) {
      msgRows = cached.rows.map((r, li) => ({
        ...r,
        key: `${m.id}:${li}`,
        streaming: Boolean(m.streaming && li === cached.rows.length - 1),
      }));
    } else {
      const lines = messageLines(m.role, m.text, width);
      msgRows = lines.map((line, li) => ({
        key: `${m.id}:${li}`,
        role: m.role,
        text: line.text,
        ...(line.segments ? { segments: line.segments } : {}),
        showRole: li === 0,
        showSep: li === 0 && showSep,
        streaming: Boolean(m.streaming && li === lines.length - 1),
      }));
      cache.set(m.id, {
        text: m.text,
        width,
        rows: msgRows.map(({ role, text, segments, showRole, showSep }) => ({
          role,
          text,
          ...(segments ? { segments } : {}),
          showRole,
          showSep,
        })),
      });
    }
    rows.push(...msgRows);
  }

  for (const id of cache.keys()) {
    if (!liveIds.has(id)) cache.delete(id);
  }
  return rows;
}

/** Line viewport; scrollOffset 0 = pinned to bottom (newest lines). */
export function viewportRows(
  rows: TranscriptRow[],
  visibleLines: number,
  scrollOffset: number
): TranscriptViewport {
  const total = rows.length;
  const cap = Math.max(4, visibleLines);
  const end = Math.max(0, total - scrollOffset);
  const start = Math.max(0, end - cap);
  return {
    visible: rows.slice(start, end),
    hiddenAbove: start,
    hiddenBelow: scrollOffset,
    atBottom: scrollOffset === 0,
    totalLines: total,
  };
}

export function maxScrollOffset(totalLines: number, visibleLines: number): number {
  return Math.max(0, totalLines - Math.max(4, visibleLines));
}

/** Row indexes whose text contains the query (case-insensitive), top to bottom. */
export function searchTranscriptRows(rows: TranscriptRow[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.text.toLowerCase().includes(q)) out.push(i);
  }
  return out;
}

/** scrollLineOffset that puts `rowIndex` at the top of the viewport (0 = bottom-pinned). */
export function scrollOffsetForRow(
  rowIndex: number,
  totalLines: number,
  visibleLines: number
): number {
  const cap = Math.max(4, visibleLines);
  const offset = totalLines - rowIndex - cap;
  return Math.min(maxScrollOffset(totalLines, visibleLines), Math.max(0, offset));
}

/** Reverse-i-search UX: first hit = newest match, repeats walk up into history, wrap. */
export function nextSearchCursor(matchCount: number, cursor: number | null): number {
  if (matchCount <= 0) return 0;
  if (cursor == null) return matchCount - 1;
  return (cursor - 1 + matchCount) % matchCount;
}

/** Human-readable scroll position for status bar. */
export function scrollPositionLabel(
  totalLines: number,
  hiddenAbove: number,
  visibleCount: number
): string | null {
  const cap = Math.max(4, visibleCount);
  if (totalLines <= cap) return null;
  const bottomLine = Math.min(totalLines, hiddenAbove + cap);
  return `L${bottomLine}/${totalLines}`;
}

export function shouldVirtualizeTranscript(totalLines: number, visibleLines: number): boolean {
  return totalLines > Math.max(4, visibleLines);
}

/**
 * Default: dump full transcript into terminal scrollback (trackpad works).
 * Virtual viewport when user keyboard-scrolls, scroll mode, or alt screen.
 */
export function useNativeTrackpadScroll(opts: {
  altScreen: boolean;
  scrollLineOffset: number;
  scrollMode: boolean;
  overlay?: boolean;
  /** When true, force virtual viewport (e.g. transient UI states). Overlays use `overlay` instead. */
  holdNativeScroll?: boolean;
}): boolean {
  return (
    !opts.altScreen &&
    opts.scrollLineOffset === 0 &&
    !opts.scrollMode &&
    !opts.overlay &&
    !opts.holdNativeScroll
  );
}

/**
 * Rows available to the transcript = terminal rows minus the surrounding chrome
 * (banner, tab bar, box borders, composer, status bar, and any live bars). The
 * caller passes the measured chrome height (I-156); the constant fallback keeps
 * old callers/tests working.
 */
export function estimateVisibleLines(rows: number, chromeLines = 11): number {
  return Math.max(6, rows - Math.max(0, chromeLines));
}

/** @deprecated message-index viewport — kept for tests */
export function viewportMessages(
  messages: ChatMessage[],
  visibleCount: number,
  scrollOffset: number
): { visible: ChatMessage[]; hiddenAbove: number; hiddenBelow: number; atBottom: boolean } {
  const total = messages.length;
  const cap = Math.max(3, visibleCount);
  const end = Math.max(0, total - scrollOffset);
  const start = Math.max(0, end - cap);
  return {
    visible: messages.slice(start, end),
    hiddenAbove: start,
    hiddenBelow: scrollOffset,
    atBottom: scrollOffset === 0,
  };
}

export function estimateVisibleMessages(rows: number): number {
  const chrome = 9;
  const lineRows = Math.max(8, rows - chrome);
  return Math.max(4, Math.floor(lineRows / 2));
}
