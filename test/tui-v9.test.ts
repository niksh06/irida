import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatTranscriptMarkdown,
  resolveExportPath,
  ExportPathError,
} from "../src/tui/exportTranscript.js";
import { mergePickerModels } from "../src/tui/models.js";
import type { ChatMessage } from "../src/tui/types.js";

describe("exportTranscript", () => {
  const msgs: ChatMessage[] = [
    { id: "1", role: "user", text: "hello" },
    { id: "2", role: "assistant", text: "hi there" },
  ];

  it("formats markdown with roles", () => {
    const md = formatTranscriptMarkdown(msgs, {
      sessionId: "sess-1",
      model: "composer-2.5",
      cwd: "/proj",
    });
    assert.match(md, /# csagent transcript/);
    assert.match(md, /## User/);
    assert.match(md, /hello/);
    assert.match(md, /## Assistant/);
    assert.match(md, /hi there/);
  });

  it("resolveExportPath stays in cwd", () => {
    const p = resolveExportPath("/proj", "sess-1");
    assert.ok(p.includes(".agent/exports"));
    assert.throws(
      () => resolveExportPath("/proj", "sess-1", "../../../etc/passwd"),
      ExportPathError
    );
  });
});

describe("mergePickerModels", () => {
  it("dedupes and keeps config model", () => {
    const m = mergePickerModels("composer-2.5", ["gpt-5.4", "composer-2.5", "gpt-5.4"]);
    assert.deepEqual(m, ["composer-2.5", "gpt-5.4"]);
  });
});
