import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSlash } from "../src/tui/slash.js";
import {
  wrapToWidth,
  viewportRows,
  maxScrollOffset,
  messagesToRows,
  nextSearchCursor,
  scrollOffsetForRow,
  searchTranscriptRows,
  viewportMessages,
} from "../src/tui/transcript.js";
import {
  commonSlashPrefix,
  filterSlashSuggestions,
  slashHelpLines,
} from "../src/tui/slashCatalog.js";
import { gatherDoctorChecks, doctorAllOk } from "../src/doctorChecks.js";
import type { ChatMessage } from "../src/tui/types.js";

describe("tui slash", () => {
  it("parses help and sessions", () => {
    assert.deepEqual(parseSlash("/help"), { type: "help" });
    assert.deepEqual(parseSlash("/"), { type: "help" });
    assert.deepEqual(parseSlash("/sessions"), { type: "sessions" });
  });

  it("parses new commands", () => {
    assert.deepEqual(parseSlash("/skills"), { type: "skills" });
    assert.deepEqual(parseSlash("/doctor"), { type: "doctor" });
    assert.deepEqual(parseSlash("/tools"), { type: "tools" });
    assert.deepEqual(parseSlash("/new"), { type: "new" });
  });

  it("parses resume with id", () => {
    assert.deepEqual(parseSlash("/resume sess-abc"), { type: "resume", sessionId: "sess-abc" });
  });

  it("returns null for normal text", () => {
    assert.equal(parseSlash("hello"), null);
  });
});

describe("slash catalog", () => {
  it("filters by prefix", () => {
    const hits = filterSlashSuggestions("/s");
    assert.ok(hits.some((h) => h.startsWith("/sessions")));
    assert.ok(hits.some((h) => h.startsWith("/skills")));
    assert.ok(filterSlashSuggestions("/re").some((h) => h.startsWith("/resume")));
  });

  it("common prefix for ambiguous tab", () => {
    const p = commonSlashPrefix(["/sessions", "/skills"]);
    assert.equal(p, "/s");
  });

  it("help lines cover all commands", () => {
    assert.ok(slashHelpLines().some((l) => l.includes("/doctor")));
  });
});

describe("doctor checks", () => {
  it("returns structured checks", () => {
    const checks = gatherDoctorChecks(process.cwd());
    assert.ok(checks.some((c) => c.name === "node >= 20"));
    assert.equal(typeof doctorAllOk(checks), "boolean");
  });
});

describe("tui transcript line viewport", () => {
  it("wraps long assistant text into multiple scrollable lines", () => {
    const long = "word ".repeat(80).trim();
    const rows = messagesToRows([{ id: "a1", role: "assistant", text: long }], 60);
    assert.ok(rows.length > 3);
    const v = viewportRows(rows, 4, 0);
    assert.equal(v.visible.length, 4);
    assert.equal(v.atBottom, true);
  });

  it("scrolls up through wrapped lines", () => {
    const long = "word ".repeat(80).trim();
    const rows = messagesToRows([{ id: "a1", role: "assistant", text: long }], 60);
    const max = maxScrollOffset(rows.length, 4);
    assert.ok(max > 0);
    const v = viewportRows(rows, 4, max);
    assert.ok(v.hiddenBelow >= max);
    assert.equal(v.atBottom, false);
  });

  it("wrapToWidth splits on spaces", () => {
    const lines = wrapToWidth("hello world foo bar baz", 12);
    assert.ok(lines.length >= 2);
  });
});

describe("tui transcript search (/find)", () => {
  const rows = messagesToRows(
    [
      { id: "u1", role: "user", text: "deploy the gateway" },
      { id: "a1", role: "assistant", text: "Gateway deployed.\nUse launchd to keep it alive." },
      { id: "u2", role: "user", text: "now check cron" },
      { id: "a2", role: "assistant", text: "Cron tick is healthy. Gateway untouched." },
    ],
    60
  );

  it("finds case-insensitive matches top to bottom", () => {
    const matches = searchTranscriptRows(rows, "gateway");
    assert.ok(matches.length >= 3);
    for (let i = 1; i < matches.length; i++) assert.ok(matches[i]! > matches[i - 1]!);
    assert.deepEqual(searchTranscriptRows(rows, "no-such-text"), []);
    assert.deepEqual(searchTranscriptRows(rows, "   "), []);
  });

  it("parseSlash handles /find with and without query", () => {
    assert.deepEqual(parseSlash("/find gateway"), { type: "find", query: "gateway" });
    assert.deepEqual(parseSlash("/find"), { type: "find", query: undefined });
    assert.deepEqual(parseSlash("/search cron tick"), { type: "find", query: "cron tick" });
  });

  it("cursor starts at newest match and walks older with wrap", () => {
    assert.equal(nextSearchCursor(3, null), 2);
    assert.equal(nextSearchCursor(3, 2), 1);
    assert.equal(nextSearchCursor(3, 0), 2);
  });

  it("scrollOffsetForRow puts the row inside the viewport", () => {
    const total = 100;
    const visible = 10;
    const offset = scrollOffsetForRow(40, total, visible);
    const v = viewportRows(Array.from({ length: total }, (_, i) => rows[0] ? { ...rows[0]!, key: `k${i}` } : rows[0]!), visible, offset);
    assert.ok(v.hiddenAbove <= 40 && 40 < v.hiddenAbove + Math.max(4, visible));
    // Bottom row clamps to 0..max.
    assert.equal(scrollOffsetForRow(total - 1, total, visible), 0);
    assert.ok(scrollOffsetForRow(0, total, visible) <= maxScrollOffset(total, visible));
  });
});

describe("tui transcript message viewport", () => {
  const msgs: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    text: `line ${i}`,
  }));

  it("legacy message viewport still works", () => {
    const v = viewportMessages(msgs, 4, 0);
    assert.equal(v.visible.length, 4);
  });
});
