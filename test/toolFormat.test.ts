import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseToolStreamEvent, formatToolInvocation } from "../src/toolFormat.js";

describe("toolFormat SDK tool_call", () => {
  it("shows full shell command from tool_call event", () => {
    const ev = {
      type: "tool_call",
      name: "shell",
      status: "running",
      call_id: "c1",
      args: { command: "npm test && npm run build" },
    };
    const a = parseToolStreamEvent(ev);
    assert.ok(a);
    assert.equal(a!.command, "npm test && npm run build");
    assert.equal(a!.phase, "call");
    assert.equal(a!.status, "running");
    assert.equal(a!.callId, "c1");
  });

  it("marks completed tool_call as result phase", () => {
    const ev = {
      type: "tool_call",
      name: "read",
      status: "completed",
      call_id: "c2",
      args: { path: "src/cli.ts" },
      result: { value: { stdout: "ok", exitCode: 0 }, status: "success", duration_ms: 120 },
    };
    const a = parseToolStreamEvent(ev);
    assert.equal(a!.phase, "result");
    assert.equal(a!.exitCode, 0);
    assert.equal(a!.durationMs, 120);
    assert.match(a!.command, /read.*cli\.ts/);
  });

  it("parses conversation shell toolCall shape", () => {
    const ev = {
      type: "toolCall",
      message: {
        type: "shell",
        args: { command: "git status --short" },
      },
    };
    const a = parseToolStreamEvent(ev);
    assert.equal(a!.command, "git status --short");
  });

  it("parses assistant tool_use block", () => {
    const ev = {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "grep", input: { pattern: "foo", path: "src" } }],
      },
    };
    const a = parseToolStreamEvent(ev);
    assert.match(a!.command, /grep/);
    assert.match(a!.command, /foo/);
  });
});

describe("formatToolInvocation", () => {
  it("prefers command field", () => {
    assert.equal(formatToolInvocation("run", { command: "echo hello world" }), "echo hello world");
  });
});
