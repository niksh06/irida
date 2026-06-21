import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRunMetrics, formatRunMetrics } from "../src/runMetrics.js";
import type { RunLogEntry } from "../src/runLog.js";

const base = (over: Partial<RunLogEntry>): RunLogEntry =>
  ({
    ts: new Date().toISOString(),
    run_id: "r",
    session_id: "s",
    sdk_run_id: null,
    status: "finished",
    error_kind: null,
    duration_ms: 1000,
    model: "claude-opus-4-8",
    runtime: "local",
    cwd: "/",
    input_tokens: null,
    output_tokens: null,
    ...over,
  }) as RunLogEntry;

describe("computeRunMetrics cost (I-116)", () => {
  const now = Date.now();
  it("sums USD across priced runs and aggregates cache tokens", () => {
    const entries = [
      base({ input_tokens: 1_000_000, output_tokens: 1_000_000 }), // opus: $5+$25=$30
      base({ cache_read_tokens: 1_000_000 }), // opus cache read: $0.50
    ];
    const m = computeRunMetrics(entries, now - 3600_000);
    assert.equal(m.costUsd, 30.5);
    assert.equal(m.cacheReadTokens, 1_000_000);
    assert.match(formatRunMetrics(m, 24), /\$30\.50 est/);
  });

  it("costUsd is null when no run has a known model", () => {
    const m = computeRunMetrics([base({ model: "composer-2.5", input_tokens: 100 })], now - 3600_000);
    assert.equal(m.costUsd, null);
    assert.doesNotMatch(formatRunMetrics(m, 24), /est/);
  });

  it("prices only the known-model runs in a mixed set", () => {
    const m = computeRunMetrics(
      [
        base({ model: "claude-sonnet-4-6", input_tokens: 1_000_000 }), // $3
        base({ model: "composer-2.5", input_tokens: 1_000_000 }), // unknown → skipped
      ],
      now - 3600_000
    );
    assert.equal(m.costUsd, 3);
  });
});
