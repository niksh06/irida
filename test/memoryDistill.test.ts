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

import { dedupDistilledNotes } from "../src/memoryDistill.js";
import { DISTILL_ARCHIVE_WING } from "../src/memoryWings.js";
import type { MemoryNote, IMemoryStore } from "../src/memoryStore.js";

/** Minimal in-memory store exposing just what dedupDistilledNotes touches. */
function fakeMemStore(notes: MemoryNote[]): IMemoryStore {
  return {
    async listNotes(wing?: string) {
      return notes.filter((n) => !wing || n.wing === wing);
    },
    async upsertNote(input: { name: string; body: string; wing?: string; title?: string }) {
      const n = notes.find((x) => x.name === input.name)!;
      n.wing = input.wing ?? n.wing;
      return n;
    },
  } as unknown as IMemoryStore;
}

const note = (name: string, title: string, body: string): MemoryNote => ({
  name, title, body, wing: DISTILL_WING, created_at: "t", updated_at: "t",
});

describe("dedupDistilledNotes (I-122 dedup-on-write)", () => {
  it("archives same-fact near-dupes by BODY overlap, keeps the richest + distinct", async () => {
    // mirrors the real prod dupe: two notes stating the same fact under different titles
    const shortBody = "For claude-agent the runtime model comes from engine.model setting.";
    const richBody = "For claude-agent the runtime model comes from engine.model setting, falling back to DEFAULT_CLAUDE_AGENT_MODEL; the top-level model field is ignored.";
    const notes = [
      note("irida-model-config", "Irida: где задаётся модель", shortBody),
      note("irida-config-model-resolution", "agent.config.json model field", richBody), // same fact, richer
      note("tparser-access", "TParser digest", "TParser is a Python Telegram parser writing to Postgres pgvector for news."), // distinct
    ];
    const { archived } = await dedupDistilledNotes(fakeMemStore(notes));
    assert.deepEqual(archived, ["irida-model-config"], "shorter same-fact note archived");
    assert.equal(notes.find((n) => n.name === "irida-config-model-resolution")!.wing, DISTILL_WING, "richer kept");
    assert.equal(notes.find((n) => n.name === "irida-model-config")!.wing, DISTILL_ARCHIVE_WING, "dupe archived");
    assert.equal(notes.find((n) => n.name === "tparser-access")!.wing, DISTILL_WING, "distinct kept");
  });

  it("no-ops when notes are about distinct topics", async () => {
    const notes = [
      note("a", "startup triage", "Gateway startup failures: check launchd, Postgres reachability, idle rotation."),
      note("b", "embeddings cache", "Cache pgvector embeddings to speed recall; invalidate on note edit."),
    ];
    const { archived } = await dedupDistilledNotes(fakeMemStore(notes));
    assert.deepEqual(archived, []);
    assert.ok(notes.every((n) => n.wing === DISTILL_WING));
  });
});
