import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldConsolidate, buildConsolidatePrompt } from "../src/memoryConsolidate.js";
import { DISTILL_WING, DISTILL_ARCHIVE_WING } from "../src/memoryWings.js";

const NOW = Date.parse("2026-06-21T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe("shouldConsolidate (I-114)", () => {
  it("skips when below the minimum note count", () => {
    assert.equal(shouldConsolidate(3, {}, NOW).run, false);
  });
  it("runs on growth threshold (≥10 new since last)", () => {
    const d = shouldConsolidate(20, { lastNoteCount: 8, lastRunAt: hoursAgo(1) }, NOW);
    assert.equal(d.run, true);
    assert.match(d.reason, /new distilled/);
  });
  it("runs on cadence even without growth", () => {
    const d = shouldConsolidate(12, { lastNoteCount: 12, lastRunAt: hoursAgo(200) }, NOW); // >168h
    assert.equal(d.run, true);
    assert.match(d.reason, /cadence/);
  });
  it("skips when no growth and cadence not due", () => {
    assert.equal(shouldConsolidate(12, { lastNoteCount: 12, lastRunAt: hoursAgo(10) }, NOW).run, false);
  });
  it("force overrides growth/cadence (but not the min-notes floor)", () => {
    assert.equal(shouldConsolidate(12, { lastNoteCount: 12, lastRunAt: hoursAgo(1) }, NOW, { force: true }).run, true);
    assert.equal(shouldConsolidate(2, {}, NOW, { force: true }).run, false); // floor still applies
  });
});

describe("buildConsolidatePrompt (I-114)", () => {
  it("includes the instruction, both wings, and the notes", () => {
    const p = buildConsolidatePrompt([
      { name: "a", body: "alpha" },
      { name: "b", body: "beta" },
    ]);
    assert.match(p, /consolidator/i);
    assert.match(p, new RegExp(DISTILL_WING));
    assert.match(p, new RegExp(DISTILL_ARCHIVE_WING));
    assert.match(p, /## a/);
    assert.match(p, /beta/);
  });
});
