import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseToolResult, formatDuration } from "../src/toolFormat.js";
import { parseStreamUsage } from "../src/host.js";
import {
  groupActivityEntries,
  activityBarSummary,
  formatGroupSummary,
  shouldShowActivityBar,
} from "../src/tui/activityGroups.js";
import type { ActivityEntry } from "../src/tui/types.js";

describe("parseToolResult", () => {
  it("extracts exit code and stdout", () => {
    const r = parseToolResult({
      value: { exitCode: 0, stdout: "hello\nworld" },
      status: "success",
    });
    assert.equal(r.exitCode, 0);
    assert.match(r.stdoutPreview ?? "", /hello/);
    assert.match(r.detail ?? "", /exit 0/);
  });

  it("formats duration", () => {
    assert.equal(formatDuration(450), "450ms");
    assert.equal(formatDuration(2500), "2.5s");
  });
});

describe("parseStreamUsage", () => {
  it("reads usage event", () => {
    const u = parseStreamUsage({ type: "usage", input_tokens: 100, output_tokens: 50 });
    assert.equal(u?.inputTokens, 100);
    assert.equal(u?.outputTokens, 50);
  });

  it("reads turn-ended InteractionUpdate from onDelta", () => {
    const u = parseStreamUsage({
      type: "turn-ended",
      usage: { inputTokens: 1200, outputTokens: 340, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    assert.equal(u?.inputTokens, 1200);
    assert.equal(u?.outputTokens, 340);
  });
});

describe("activityGroups", () => {
  const mk = (id: string, tool: string): ActivityEntry => ({
    id,
    at: new Date().toISOString(),
    label: tool,
    kind: "tool",
    toolName: tool,
    command: `${tool} cmd`,
    status: "completed",
    exitCode: 0,
    durationMs: 100,
  });

  it("groups consecutive same tool", () => {
    const g = groupActivityEntries([mk("1", "shell"), mk("2", "shell"), mk("3", "read")]);
    assert.equal(g.length, 2);
    assert.equal(g[0]!.count, 2);
    assert.equal(g[1]!.count, 1);
  });

  it("summarizes bar for many shell calls", () => {
    const entries = Array.from({ length: 5 }, (_, i) => mk(String(i), "shell"));
    const s = activityBarSummary(entries, false);
    assert.match(s, /shell ×5/);
  });

  it("formatGroupSummary shows exit and duration", () => {
    const g = groupActivityEntries([mk("1", "shell")])[0]!;
    assert.match(formatGroupSummary(g), /exit 0/);
    assert.match(formatGroupSummary(g), /100ms/);
  });

  it("shouldShowActivityBar hides stale thinking placeholder after turn", () => {
    const thinkingOnly = [
      {
        id: "1",
        at: new Date().toISOString(),
        label: "thinking…",
        kind: "other" as const,
        command: "waiting for model",
        phase: "call" as const,
      },
    ];
    assert.equal(shouldShowActivityBar(thinkingOnly, false, null), false);
    assert.equal(shouldShowActivityBar(thinkingOnly, true, null), true);
    assert.equal(shouldShowActivityBar([mk("1", "shell")], false, null), true);
  });
});
