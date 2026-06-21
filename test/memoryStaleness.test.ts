import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stalenessNote, staleMarker, staleDays, DEFAULT_STALENESS_DAYS } from "../src/memoryStaleness.js";

const NOW = Date.parse("2026-06-21T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe("stalenessNote (I-115)", () => {
  it("is null for a fresh note (within threshold)", () => {
    assert.equal(stalenessNote(daysAgo(2), NOW), null);
    assert.equal(stalenessNote(daysAgo(DEFAULT_STALENESS_DAYS), NOW), null); // exactly at boundary
  });

  it("flags a note older than the threshold with the day count", () => {
    const note = stalenessNote(daysAgo(30), NOW);
    assert.ok(note);
    assert.match(note!, /30d ago/);
    assert.match(note!, /verify it still exists/);
  });

  it("honors a custom maxAgeDays", () => {
    assert.equal(stalenessNote(daysAgo(2), NOW, 1) != null, true); // 2d > 1d → stale
    assert.equal(stalenessNote(daysAgo(2), NOW, 5), null); // 2d < 5d → fresh
  });

  it("maxAgeDays <= 0 disables (treats nothing as stale)", () => {
    assert.equal(stalenessNote(daysAgo(365), NOW, 0), null);
    assert.equal(stalenessNote(daysAgo(365), NOW, -1), null);
  });

  it("is null for undated / unparseable timestamps", () => {
    assert.equal(stalenessNote(undefined, NOW), null);
    assert.equal(stalenessNote(null, NOW), null);
    assert.equal(stalenessNote("not-a-date", NOW), null);
  });
});

describe("staleDays + staleMarker (I-115)", () => {
  it("staleDays returns floored age when stale, null when fresh/disabled", () => {
    assert.equal(staleDays(daysAgo(30), NOW), 30);
    assert.equal(staleDays(daysAgo(2), NOW), null);
    assert.equal(staleDays(daysAgo(365), NOW, 0), null);
  });
  it("staleMarker is compact ⚠Nd for stale, null for fresh", () => {
    assert.equal(staleMarker(daysAgo(30), NOW), "⚠30d");
    assert.equal(staleMarker(daysAgo(2), NOW), null);
  });
});
