import type { RunRecord } from "../store.js";
import type { ChatMessage, MessageRole } from "./types.js";

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
  text: string;
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

/** Word-wrap plain text to fit transcript column width. */
export function wrapToWidth(text: string, width: number): string[] {
  const max = Math.max(16, width - 8);
  if (!text) return [""];
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let rest = paragraph;
    if (!rest) {
      out.push("");
      continue;
    }
    while (rest.length > max) {
      let cut = max;
      const sp = rest.lastIndexOf(" ", max);
      if (sp > Math.floor(max * 0.35)) cut = sp;
      out.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    out.push(rest);
  }
  return out.length ? out : [""];
}

export function messagesToRows(messages: ChatMessage[], width: number): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const lines = wrapToWidth(m.text, width);
    const showSep = m.role === "user" && i > 0 && messages[i - 1]?.role !== "system";
    for (let li = 0; li < lines.length; li++) {
      rows.push({
        key: `${m.id}:${li}`,
        role: m.role,
        text: lines[li]!,
        showRole: li === 0,
        showSep: li === 0 && showSep,
        streaming: Boolean(m.streaming && li === lines.length - 1),
      });
    }
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

export function estimateVisibleLines(rows: number): number {
  const chrome = 11;
  return Math.max(6, rows - chrome);
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
