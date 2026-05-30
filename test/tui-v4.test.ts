import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSlash } from "../src/tui/slash.js";
import { listPickerModels } from "../src/tui/models.js";
import { listMcpEntries } from "../src/tui/mcpView.js";
import { lastAssistantText } from "../src/tui/clipboard.js";
import { eventActivityDetail } from "../src/host.js";

describe("tui v4 slash", () => {
  it("parses model mcp copy", () => {
    assert.deepEqual(parseSlash("/model"), { type: "model" });
    assert.deepEqual(parseSlash("/mcp"), { type: "mcp" });
    assert.deepEqual(parseSlash("/copy"), { type: "copy" });
  });
});

describe("tui v4 models", () => {
  it("includes config model in picker list", () => {
    const models = listPickerModels(process.cwd());
    assert.ok(models.length >= 1);
  });
});

describe("tui v4 mcp view", () => {
  it("returns entries array", () => {
    const v = listMcpEntries(process.cwd());
    assert.ok(Array.isArray(v.entries));
    assert.ok(Array.isArray(v.errors));
  });
});

describe("tui v4 clipboard", () => {
  it("finds last assistant text", () => {
    const t = lastAssistantText([
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello" },
    ]);
    assert.equal(t, "hello");
  });
});

describe("eventActivityDetail", () => {
  it("labels tool calls with kind", () => {
    const d = eventActivityDetail({ type: "tool_call", name: "read_file", server: "fs" });
    assert.equal(d?.kind, "mcp");
    assert.match(d?.label ?? "", /read_file/);
  });
});
