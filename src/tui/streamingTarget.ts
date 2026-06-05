import type { ChatMessage } from "./types.js";

/** Last assistant bubble still streaming (may not be the final message after rotation notices). */
export function indexOfStreamingAssistant(messages: readonly ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "assistant" && m.streaming) return i;
  }
  return -1;
}

/** Last assistant message in transcript (for turn completion / errors). */
export function indexOfLastAssistant(messages: readonly ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") return i;
  }
  return -1;
}
