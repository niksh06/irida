import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSlash } from "../src/tui/slash.js";
import {
  wrapToWidth,
  viewportRows,
  maxScrollOffset,
  messagesToRows,
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
