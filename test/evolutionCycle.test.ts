import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeRunSignals,
  hasSignalToPropose,
  parseProposal,
  buildProposerPrompt,
  isDuplicateProposal,
  tryAutoApplySkill,
  type EvolutionProposal,
} from "../src/evolutionCycle.js";
import type { RunLogEntry } from "../src/runLog.js";
import type { SkillRunner, SkillJudge, SkillEvalTask } from "../src/skillFitness.js";
import { loadConfig } from "../src/config.js";
import { loadSkillLedger } from "../src/skillApply.js";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve as pathResolve, join as pathJoin } from "node:path";

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

describe("parseProposal — skill NAME/BODY (I-98 L1 ph.3)", () => {
  it("captures NAME and BODY for a skill draft without leaking BODY into DETAIL", () => {
    const reply = [
      "KIND: skill",
      "NAME: retry-flaky",
      "TITLE: retry flaky shell steps",
      "DETAIL: shell steps fail transiently; a bounded retry reduces failures.",
      "BODY: ---",
      "name: retry-flaky",
      "description: bounded retry",
      "---",
      "Wrap transient commands in a bounded retry with backoff.",
    ].join("\n");
    const p = parseProposal(reply, "id1", "t1");
    assert.ok(p);
    assert.equal(p!.kind, "skill");
    assert.equal(p!.name, "retry-flaky");
    assert.match(p!.detail, /transiently/);
    assert.doesNotMatch(p!.detail, /backoff/, "BODY must not bleed into DETAIL");
    assert.match(p!.body!, /Wrap transient commands/);
  });

  it("does not attach name/body for non-skill kinds", () => {
    const p = parseProposal("KIND: memory\nNAME: x\nTITLE: t\nDETAIL: d\nBODY: b", "id", "at");
    assert.equal(p!.kind, "memory");
    assert.equal(p!.name, undefined);
    assert.equal(p!.body, undefined);
  });
});

describe("tryAutoApplySkill — fitness gate orchestration (I-98 L1 ph.3)", () => {
  const TASKS: SkillEvalTask[] = [
    { id: "t1", prompt: "p1", rubric: "r1" },
    { id: "t2", prompt: "p2", rubric: "r2" },
  ];
  const runner: SkillRunner = async (_p, skill) => (skill ? "WITH" : "BASE");
  const judge = (v: Record<string, "better" | "worse" | "same">): SkillJudge =>
    async (task) => ({ verdict: v[task.id] ?? "same", note: "n" });

  function sandbox() {
    const dir = mkdtempSync(pathResolve(tmpdir(), "evo-l1-"));
    mkdirSync(pathJoin(dir, "skills"), { recursive: true });
    writeFileSync(pathJoin(dir, "agent.config.json"), JSON.stringify({ stateDir: ".agent", engine: { provider: "claude-agent" } }) + "\n");
    const prev = { H: process.env.IRIDA_HOME, R: process.env.IRIDA_ROOT };
    process.env.IRIDA_HOME = dir;
    process.env.IRIDA_ROOT = dir;
    return {
      dir,
      restore: () => {
        prev.H === undefined ? delete process.env.IRIDA_HOME : (process.env.IRIDA_HOME = prev.H);
        prev.R === undefined ? delete process.env.IRIDA_ROOT : (process.env.IRIDA_ROOT = prev.R);
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  const skillProposal = (): EvolutionProposal => ({
    id: "ev1", at: "t", kind: "skill", status: "pending",
    title: "retry flaky", name: "retry-flaky",
    body: "---\nname: retry-flaky\ndescription: bounded retry\n---\nUse a bounded retry with backoff.",
  });

  it("applies the skill when the gate passes", async () => {
    const sb = sandbox();
    try {
      const cfg = loadConfig(sb.dir);
      const out = await tryAutoApplySkill(sb.dir, cfg, skillProposal(), {
        tasks: TASKS, runner, judge: judge({ t1: "better", t2: "better" }),
      });
      assert.equal(out.applied, true);
      assert.match(out.fitness, /PASS/);
      assert.ok(existsSync(pathJoin(sb.dir, "skills", "retry-flaky.md")), "skill written");
      const ledger = loadSkillLedger(sb.dir);
      assert.equal(ledger.applied[0]!.name, "retry-flaky");
    } finally {
      sb.restore();
    }
  });

  it("does NOT apply when the gate fails (regression) → routes to queue", async () => {
    const sb = sandbox();
    try {
      const cfg = loadConfig(sb.dir);
      const out = await tryAutoApplySkill(sb.dir, cfg, skillProposal(), {
        tasks: TASKS, runner, judge: judge({ t1: "better", t2: "worse" }),
      });
      assert.equal(out.applied, false);
      assert.match(out.fitness, /FAIL/);
      assert.equal(existsSync(pathJoin(sb.dir, "skills", "retry-flaky.md")), false, "skill not written");
    } finally {
      sb.restore();
    }
  });

  it("returns applied:false when the proposal has no body", async () => {
    const sb = sandbox();
    try {
      const cfg = loadConfig(sb.dir);
      const p = { ...skillProposal(), body: undefined };
      const out = await tryAutoApplySkill(sb.dir, cfg, p, { tasks: TASKS, runner, judge: judge({}) });
      assert.equal(out.applied, false);
      assert.match(out.summary, /lacks a body/);
    } finally {
      sb.restore();
    }
  });
});

describe("engine.evolution.autoApplySkills config flag (I-98 L1 ph.3)", () => {
  function cfgDir(engineJson: unknown): { dir: string; restore: () => void } {
    const dir = mkdtempSync(pathResolve(tmpdir(), "evo-cfg-"));
    writeFileSync(pathJoin(dir, "agent.config.json"), JSON.stringify({ engine: engineJson }) + "\n");
    return { dir, restore: () => rmSync(dir, { recursive: true, force: true }) };
  }
  it("round-trips true and defaults to off when absent", () => {
    const on = cfgDir({ provider: "claude-agent", evolution: { autoApplySkills: true } });
    try {
      assert.equal(loadConfig(on.dir).engine.evolution?.autoApplySkills, true);
    } finally {
      on.restore();
    }
    const off = cfgDir({ provider: "claude-agent" });
    try {
      assert.equal(loadConfig(off.dir).engine.evolution?.autoApplySkills, undefined);
      assert.ok(!loadConfig(off.dir).engine.evolution?.autoApplySkills, "absent ⇒ falsy ⇒ off");
    } finally {
      off.restore();
    }
  });
});
