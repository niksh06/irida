import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSlash } from "../src/tui/slash.js";
import { viewportMessages } from "../src/tui/transcript.js";
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

describe("tui transcript viewport", () => {
  const msgs: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    text: `line ${i}`,
  }));

  it("shows tail when scrollOffset is 0", () => {
    const v = viewportMessages(msgs, 4, 0);
    assert.equal(v.visible.length, 4);
    assert.equal(v.visible[0]?.text, "line 6");
    assert.equal(v.atBottom, true);
  });

  it("scrolls up with offset", () => {
    const v = viewportMessages(msgs, 4, 4);
    assert.equal(v.visible[0]?.text, "line 2");
    assert.equal(v.hiddenBelow, 4);
  });
});
