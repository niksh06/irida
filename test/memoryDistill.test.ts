import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isDistillCandidate,
  sessionNeedsDistill,
  buildDistillPrompt,
  DISTILL_WING,
} from "../src/memoryDistill.js";
import type { SessionRecord, RunRecord } from "../src/store.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sess = (over: Partial<SessionRecord>): SessionRecord =>
  ({
    id: "sess_1",
    title: "chat",
    cwd: "/Users/nsh/Downloads/TParser",
    runtime: "local",
    channel: "telegram",
    created_at: "2026-06-20T00:00:00Z",
    updated_at: "2026-06-21T00:00:00Z",
    ...over,
  }) as SessionRecord;

const run = (over: Partial<RunRecord>): RunRecord =>
  ({
    id: "r",
    cwd: "/Users/nsh/Downloads/TParser",
    status: "finished",
    is_test: false,
    started_at: "2026-06-21T00:00:00Z",
    prompt_preview: "do a thing",
    result_preview: "done",
    ...over,
  }) as RunRecord;

describe("isDistillCandidate (I-113)", () => {
  it("accepts a telegram session with ≥2 finished real runs", () => {
    assert.equal(isDistillCandidate(sess({}), [run({}), run({})]), true);
  });
  it("rejects non-distill surfaces (tui/cli/empty channel)", () => {
    assert.equal(isDistillCandidate(sess({ channel: "tui" }), [run({}), run({})]), false);
    assert.equal(isDistillCandidate(sess({ channel: "" }), [run({}), run({})]), false);
  });
  it("rejects trivial sessions (<2 real finished runs)", () => {
    assert.equal(isDistillCandidate(sess({}), [run({})]), false);
    assert.equal(isDistillCandidate(sess({}), [run({ status: "error" }), run({ status: "error" })]), false);
    assert.equal(isDistillCandidate(sess({}), [run({ is_test: true }), run({ is_test: true })]), false);
  });
  it("rejects test/temp-noise cwd sessions", () => {
    const noisy = sess({ cwd: join(tmpdir(), "rotate-fail-abc") });
    assert.equal(isDistillCandidate(noisy, [run({ cwd: noisy.cwd }), run({ cwd: noisy.cwd })]), false);
  });
});

describe("sessionNeedsDistill (I-113)", () => {
  const s = sess({ updated_at: "2026-06-21T00:00:00Z" });
  it("needs distill when never processed", () => {
    assert.equal(sessionNeedsDistill(s, undefined, false), true);
  });
  it("needs distill when the session changed since last processed", () => {
    assert.equal(sessionNeedsDistill(s, "2026-06-20T00:00:00Z", false), true);
  });
  it("skips when already processed at the same/newer mark", () => {
    assert.equal(sessionNeedsDistill(s, "2026-06-21T00:00:00Z", false), false);
    assert.equal(sessionNeedsDistill(s, "2026-06-22T00:00:00Z", false), false);
  });
  it("force re-distills", () => {
    assert.equal(sessionNeedsDistill(s, "2026-06-22T00:00:00Z", true), true);
  });
});

describe("buildDistillPrompt (I-113)", () => {
  it("includes the extraction instruction, the distill wing, and session id", () => {
    const p = buildDistillPrompt(sess({ id: "sess_X", title: "T" }), [run({})]);
    assert.match(p, /memory distiller/i);
    assert.match(p, new RegExp(DISTILL_WING));
    assert.match(p, /SESSION sess_X/);
    assert.match(p, /memory_fact_add/);
  });
});
