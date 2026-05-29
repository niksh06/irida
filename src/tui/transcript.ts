import type { RunRecord } from "../store.js";
import type { ChatMessage } from "./types.js";

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

export interface TranscriptViewport {
  visible: ChatMessage[];
  hiddenAbove: number;
  hiddenBelow: number;
  atBottom: boolean;
}

/** Message-index viewport; scrollOffset 0 pins to the latest messages. */
export function viewportMessages(
  messages: ChatMessage[],
  visibleCount: number,
  scrollOffset: number
): TranscriptViewport {
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
