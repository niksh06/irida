import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeRunSignals,
  hasSignalToPropose,
  parseProposal,
  buildProposerPrompt,
  isDuplicateProposal,
  type EvolutionProposal,
} from "../src/evolutionCycle.js";
import type { RunLogEntry } from "../src/runLog.js";

const proposal = (title: string, status: EvolutionProposal["status"] = "pending"): EvolutionProposal =>
  ({ id: "x", at: "t", kind: "memory", title, detail: "", status });

const NOW = Date.parse("2026-06-21T12:00:00Z");
const entry = (over: Partial<RunLogEntry>): RunLogEntry =>
  ({ ts: new Date(NOW - 3600_000).toISOString(), status: "finished", error_kind: null, ...over }) as RunLogEntry;

describe("summarizeRunSignals (I-98)", () => {
  it("counts failures by error_kind within the window", () => {
    const s = summarizeRunSignals(
      [
        entry({ status: "finished" }),
        entry({ status: "error", error_kind: "timeout" }),
        entry({ status: "error", error_kind: "timeout" }),
        entry({ status: "error", error_kind: "rate_limit" }),
      ],
      NOW,
      48
    );
    assert.equal(s.total, 4);
    assert.equal(s.failed, 3);
    assert.deepEqual(s.errorKinds, { timeout: 2, rate_limit: 1 });
  });
  it("excludes entries outside the window", () => {
    const old = entry({ ts: new Date(NOW - 100 * 3600_000).toISOString(), status: "error", error_kind: "x" });
    const s = summarizeRunSignals([old], NOW, 48);
    assert.equal(s.total, 0);
    assert.equal(s.failed, 0);
  });
});

describe("hasSignalToPropose (I-98)", () => {
  const none = { total: 5, failed: 0, errorKinds: {} };
  it("true when any of failures / lesson gaps / eval failures present", () => {
    assert.equal(hasSignalToPropose({ ...none, failed: 1 }, 0, 0), true);
    assert.equal(hasSignalToPropose(none, 2, 0), true);
    assert.equal(hasSignalToPropose(none, 0, 1), true);
  });
  it("false when all clean", () => {
    assert.equal(hasSignalToPropose(none, 0, 0), false);
  });
});

describe("parseProposal (I-98)", () => {
  it("parses a well-formed proposal", () => {
    const p = parseProposal("KIND: skill\nTITLE: add retry wrapper\nDETAIL: wrap X with retry\nbecause timeouts", "id1", "t");
    assert.ok(p);
    assert.equal(p!.kind, "skill");
    assert.equal(p!.title, "add retry wrapper");
    assert.match(p!.detail, /wrap X with retry/);
    assert.equal(p!.status, "pending");
  });
  it("returns null for NO PROPOSAL", () => {
    assert.equal(parseProposal("NO PROPOSAL", "id", "t"), null);
    assert.equal(parseProposal("   ", "id", "t"), null);
  });
  it("defaults kind to other when missing, null when no TITLE", () => {
    assert.equal(parseProposal("some freeform text", "id", "t"), null);
    const p = parseProposal("TITLE: only a title", "id", "t");
    assert.equal(p!.kind, "other");
  });
});

describe("buildProposerPrompt (I-98)", () => {
  it("includes the proposer instruction and the signals, with no-write guidance", () => {
    const p = buildProposerPrompt("runs: 3 failed");
    assert.match(p, /evolution proposer/i);
    assert.match(p, /do NOT write memory/i);
    assert.match(p, /runs: 3 failed/);
  });

  it("surfaces pending proposals with a do-not-duplicate instruction", () => {
    const p = buildProposerPrompt("signals", ["Add a startup-failure note", "Cache embeddings"]);
    assert.match(p, /already proposed/i);
    assert.match(p, /do not re-propose/i);
    assert.match(p, /Add a startup-failure note/);
    assert.match(p, /Cache embeddings/);
  });
  it("omits the pending section when the queue is empty", () => {
    assert.doesNotMatch(buildProposerPrompt("signals", []), /already proposed/i);
  });
});

describe("isDuplicateProposal (I-98 dedup — high-precision backstop)", () => {
  it("flags a proposal whose concept is contained in a pending one", () => {
    const pending = [proposal("Add a startup-failure triage note for gateway runs")]; // {startup,failure,triage}
    // fully contains the pending concept tokens → coverage 1.0
    assert.equal(isDuplicateProposal(proposal("Expand ops stub into a startup-failure triage checklist"), pending), true);
    // near-identical (shares 3 of ~4 significant tokens)
    assert.equal(isDuplicateProposal(proposal("startup failure triage playbook"), pending), true);
  });
  it("does NOT silently drop a lexically-similar but distinct proposal (left to the prompt)", () => {
    // differ-by-one-token pairs (Jaccard 0.5, coverage 0.67) stay BELOW the backstop bar
    assert.equal(isDuplicateProposal(proposal("memory search ranking"), [proposal("memory search latency")]), false);
    assert.equal(
      isDuplicateProposal(
        proposal("Add a startup-failure preflight note"),
        [proposal("Add a startup-failure triage note")]
      ),
      false
    );
  });
  it("lets a genuinely distinct proposal through", () => {
    const pending = [proposal("Add a startup-failure triage note for gateway runs")];
    assert.equal(isDuplicateProposal(proposal("Cache pgvector embeddings for faster recall"), pending), false);
  });
  it("ignores non-pending proposals and needs ≥2 shared significant tokens", () => {
    assert.equal(isDuplicateProposal(proposal("startup failure triage"), [proposal("startup failure triage", "applied")]), false);
    assert.equal(isDuplicateProposal(proposal("memory search ranking"), [proposal("memory dedup pass")]), false);
  });
});
