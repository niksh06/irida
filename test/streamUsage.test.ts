import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStreamUsage } from "../src/host.js";

describe("parseStreamUsage cache tokens (I-116)", () => {
  it("extracts cache_read / cache_creation from a result message", () => {
    const u = parseStreamUsage({
      type: "result",
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 1000,
      },
    });
    assert.equal(u?.inputTokens, 100);
    assert.equal(u?.outputTokens, 200);
    assert.equal(u?.cacheReadTokens, 5000);
    assert.equal(u?.cacheCreationTokens, 1000);
  });

  it("returns usage when only cache fields are present", () => {
    const u = parseStreamUsage({ usage: { cache_read_input_tokens: 42 } });
    assert.equal(u?.cacheReadTokens, 42);
  });

  it("still returns null for an event with no usage", () => {
    assert.equal(parseStreamUsage({ type: "text", text: "hi" }), null);
  });
});
