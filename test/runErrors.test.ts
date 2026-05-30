import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatRunErrorMessage, pickRunErrorDetail } from "../src/runErrors.js";

describe("formatRunErrorMessage", () => {
  it("includes tool count and sdk detail", () => {
    const out = formatRunErrorMessage({
      res: { id: "run_abc123", error: "max steps exceeded" },
      toolCalls: 31,
      turnText: "Found 3 XSS items…",
    });
    assert.match(out.message, /31 tool call/);
    assert.match(out.message, /max steps exceeded/);
    assert.equal(out.partialAssistantText, "Found 3 XSS items…");
  });

  it("redacts secrets in detail", () => {
    assert.match(
      pickRunErrorDetail({ message: "CURSOR_API_KEY=secret123 failed" }) ?? "",
      /<redacted>/
    );
  });

  it("falls back hint when no detail", () => {
    const out = formatRunErrorMessage({ res: {}, toolCalls: 5, turnText: "" });
    assert.match(out.message, /Common causes/);
    assert.equal(out.partialAssistantText, undefined);
  });
});
