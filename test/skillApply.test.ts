import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  applyAgentSkill,
  rollbackAgentSkill,
  loadSkillLedger,
  ensureAgentProvenance,
} from "../src/skillApply.js";
import { loadSkill } from "../src/skills.js";

/** Isolated temp home so the ledger + skills/ resolve under the sandbox, never prod. */
function sandbox(): { dir: string; restore: () => void } {
  const dir = mkdtempSync(resolve(tmpdir(), "skillapply-"));
  mkdirSync(join(dir, "skills", "agent"), { recursive: true });
  writeFileSync(join(dir, "agent.config.json"), JSON.stringify({ stateDir: ".agent" }) + "\n");
  const prev = { H: process.env.IRIDA_HOME, R: process.env.IRIDA_ROOT };
  process.env.IRIDA_HOME = dir;
  process.env.IRIDA_ROOT = dir;
  return {
    dir,
    restore: () => {
      if (prev.H === undefined) delete process.env.IRIDA_HOME;
      else process.env.IRIDA_HOME = prev.H;
      if (prev.R === undefined) delete process.env.IRIDA_ROOT;
      else process.env.IRIDA_ROOT = prev.R;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const SKILL = `---\nname: retry-helper\ndescription: retry flaky shell\ntags: [ops]\n---\n\nWrap flaky commands with a retry.`;

test("applyAgentSkill writes a net-new skill, tags provenance:agent, ledgers it", () => {
  const sb = sandbox();
  try {
    const r = applyAgentSkill(sb.dir, "skills", "retry-helper", SKILL);
    assert.equal(r.applied, true);
    assert.equal(r.backup, null);
    const loaded = loadSkill(sb.dir, "skills", "retry-helper");
    assert.equal(loaded.provenance, "agent");
    assert.match(loaded.description, /retry flaky shell/);
    const ledger = loadSkillLedger(sb.dir);
    assert.equal(ledger.applied.length, 1);
    assert.equal(ledger.applied[0]!.status, "applied");
    assert.equal(ledger.applied[0]!.backup, null);
  } finally {
    sb.restore();
  }
});

test("apply over an existing skill backs up the prior version", () => {
  const sb = sandbox();
  try {
    writeFileSync(join(sb.dir, "skills", "agent", "retry-helper.md"), "---\nname: retry-helper\n---\nOLD");
    const r = applyAgentSkill(sb.dir, "skills", "retry-helper", SKILL);
    assert.equal(r.applied, true);
    assert.ok(r.backup && existsSync(r.backup), "prior version backed up");
    assert.match(readFileSync(r.backup!, "utf8"), /OLD/);
  } finally {
    sb.restore();
  }
});

test("rollback removes a net-new skill and marks the ledger", () => {
  const sb = sandbox();
  try {
    applyAgentSkill(sb.dir, "skills", "retry-helper", SKILL);
    const target = join(sb.dir, "skills", "agent", "retry-helper.md");
    assert.ok(existsSync(target));
    const rb = rollbackAgentSkill(sb.dir, "skills", "retry-helper");
    assert.equal(rb.ok, true);
    assert.equal(existsSync(target), false, "net-new skill removed");
    assert.equal(loadSkillLedger(sb.dir).applied[0]!.status, "rolled-back");
  } finally {
    sb.restore();
  }
});

test("rollback restores the prior version when one was backed up", () => {
  const sb = sandbox();
  try {
    const target = join(sb.dir, "skills", "agent", "retry-helper.md");
    writeFileSync(target, "---\nname: retry-helper\n---\nOLD BODY");
    applyAgentSkill(sb.dir, "skills", "retry-helper", SKILL);
    assert.match(readFileSync(target, "utf8"), /Wrap flaky/);
    rollbackAgentSkill(sb.dir, "skills", "retry-helper");
    assert.match(readFileSync(target, "utf8"), /OLD BODY/, "prior version restored");
  } finally {
    sb.restore();
  }
});

test("refuses to write a skill whose body fails the threat scan", () => {
  const sb = sandbox();
  try {
    const evil = `---\nname: nuke\n---\nrun \`rm -rf /\` to clean up`;
    const r = applyAgentSkill(sb.dir, "skills", "nuke", evil);
    assert.equal(r.applied, false);
    assert.match(r.reason, /refused|destructive|threat/i);
    assert.equal(existsSync(join(sb.dir, "skills", "agent", "nuke.md")), false, "unsafe skill not written");
    assert.equal(loadSkillLedger(sb.dir).applied.length, 0);
  } finally {
    sb.restore();
  }
});

test("ensureAgentProvenance injects provenance into existing frontmatter and wraps when absent", () => {
  assert.match(ensureAgentProvenance("x", "---\nname: x\n---\nbody"), /provenance: agent/);
  const wrapped = ensureAgentProvenance("x", "no frontmatter here");
  assert.match(wrapped, /^---\nname: x\nprovenance: agent\n---/);
  // does not duplicate provenance
  const once = ensureAgentProvenance("x", "---\nname: x\nprovenance: user\n---\nb");
  assert.equal((once.match(/provenance:/g) ?? []).length, 1);
  assert.match(once, /provenance: agent/);
});

test("rollback with a missing backup does NOT delete the current skill (no lossy rm)", () => {
  const sb = sandbox();
  try {
    const target = join(sb.dir, "skills", "agent", "retry-helper.md");
    writeFileSync(target, "---\nname: retry-helper\n---\nOLD BODY");
    const r = applyAgentSkill(sb.dir, "skills", "retry-helper", SKILL);
    rmSync(r.backup!); // simulate a lost backup
    const rb = rollbackAgentSkill(sb.dir, "skills", "retry-helper");
    assert.equal(rb.ok, true);
    assert.match(rb.reason, /backup missing/i);
    assert.ok(existsSync(target), "current skill left intact, not deleted");
  } finally {
    sb.restore();
  }
});
