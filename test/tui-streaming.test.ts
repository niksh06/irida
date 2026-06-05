import { test } from "node:test";
import assert from "node:assert/strict";
import { indexOfLastAssistant, indexOfStreamingAssistant } from "../src/tui/streamingTarget.js";
import type { ChatMessage } from "../src/tui/types.js";

test("indexOfStreamingAssistant skips system lines after rotation", () => {
  const messages: ChatMessage[] = [
    { id: "1", role: "user", text: "hi" },
    { id: "2", role: "assistant", text: "", streaming: true },
    { id: "3", role: "system", text: "· Session idle · refreshed agent" },
  ];
  assert.equal(indexOfStreamingAssistant(messages), 1);
  assert.equal(indexOfLastAssistant(messages), 1);
});
