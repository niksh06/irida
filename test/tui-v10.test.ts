import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterSessions, mergeSessionFilterInput, sessionDisplayTitle, sessionPickerWindow } from "../src/tui/sessionSearch.js";
import {
  parseContextRefPrefix,
  applyContextRefCompletion,
  commonPathPrefix,
} from "../src/tui/pathComplete.js";
import { eventThinkingText } from "../src/host.js";
import type { SessionRecord } from "../src/store.js";

const sampleSession = (id: string, title: string): SessionRecord => ({
  id,
  title,
  cwd: "/proj",
  runtime: "local",
  sdk_agent_id: null,
  created_at: "",
  updated_at: "",
  last_status: "finished",
  selected_skills: "",
  mcp_server_names: "",
});

describe("sessionSearch", () => {
  it("filters by title and id", () => {
    const sessions = [sampleSession("sess-abc", "kafka debug"), sampleSession("sess-xyz", "other")];
    const hits = filterSessions(sessions, "kafka");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.id, "sess-abc");
  });

  it("sessionDisplayTitle prefers title", () => {
    assert.equal(sessionDisplayTitle(sampleSession("sess-1", "My chat")), "My chat");
    assert.match(sessionDisplayTitle(sampleSession("sess-long-id-99", "chat session")), /sess-long/);
  });

  it("mergeSessionFilterInput supports paste", () => {
    assert.equal(mergeSessionFilterInput("", "track", {}), "track");
    assert.equal(mergeSessionFilterInput("ab", "cd", {}), "abcd");
    assert.equal(mergeSessionFilterInput("abc", "", { backspace: true }), "ab");
  });

  it("sessionPickerWindow scrolls long lists", () => {
    const items = Array.from({ length: 24 }, (_, i) => i);
    const w = sessionPickerWindow(items, 12, 10);
    assert.equal(w.visible.length, 10);
    assert.equal(w.visible[0], 7);
    assert.equal(w.hiddenAbove, 7);
    assert.equal(w.hiddenBelow, 7);
  });
});

describe("pathComplete", () => {
  it("parses @file prefix", () => {
    const ref = parseContextRefPrefix("review @file:src/cli");
    assert.ok(ref);
    assert.equal(ref!.kind, "file");
    assert.equal(ref!.prefix, "src/cli");
  });

  it("applies completion", () => {
    const ref = parseContextRefPrefix("x @file:src")!;
    const next = applyContextRefCompletion("x @file:src", ref, "src/cli.ts");
    assert.equal(next, "x @file:src/cli.ts");
  });

  it("commonPathPrefix", () => {
    assert.equal(commonPathPrefix(["src/a.ts", "src/b.ts"]), "src/");
  });
});

describe("eventThinkingText", () => {
  it("reads thinking message", () => {
    assert.equal(eventThinkingText({ type: "thinking", text: "hmm" }), "hmm");
  });
});
