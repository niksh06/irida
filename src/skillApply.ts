/**
 * Apply / roll back agent-authored skills (I-98 L1, phase 1 — the rollback
 * foundation). Auto-applied skills live in the normal skills/ dir tagged
 * `provenance: agent`, so they load like any skill but are distinguishable for
 * the curator and for rollback. Every apply threat-scans the body first (an
 * unsafe skill is never written), backs up any prior version, and records an
 * entry in `<stateDir>/evolution.skills.json`. Rollback restores the backup (or
 * removes a net-new skill) — no prod-git required.
 */
import { existsSync, readFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadConfig } from "./config.js";
import { scanThreatPatterns } from "./promptThreatScan.js";
import { isDestructive } from "./safety.js";
import { writeFileAtomic } from "./util.js";

/** Cap the apply ledger so an autonomous loop can't grow it unbounded. */
const LEDGER_CAP = 100;

/**
 * Deterministic WRITE root for agent skills: always `<dir>/<skillsPath>`, never
 * the cwd fall-through that `resolveSkillsRoot` allows for *reads* — writing a
 * net-new skill must never land in some other repo's skills/ (audit, phase 1).
 */
function skillWriteRoot(dir: string, skillsPath: string): string {
  return resolve(dir, skillsPath);
}

export interface AppliedSkill {
  name: string;
  at: string;
  status: "applied" | "rolled-back";
  /** Fitness score at apply time (phase 2 wires this); null when applied without a gate. */
  evalScore?: number | null;
  /** Backup of the pre-apply version, or null when the skill was net-new. */
  backup?: string | null;
}

export interface SkillLedger {
  applied: AppliedSkill[];
}

export class SkillApplyError extends Error {}

function sanitizeSkillName(name: string): string {
  const n = name.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  if (!n || n === "." || n === "..") throw new SkillApplyError(`invalid skill name: ${name}`);
  return n;
}

function ledgerPath(dir: string): string {
  return resolve(dir, loadConfig(dir).stateDir, "evolution.skills.json");
}

export function loadSkillLedger(dir: string): SkillLedger {
  const p = ledgerPath(dir);
  if (!existsSync(p)) return { applied: [] };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return { applied: Array.isArray(parsed.applied) ? parsed.applied : [] };
  } catch {
    return { applied: [] };
  }
}

export function saveSkillLedger(dir: string, ledger: SkillLedger): void {
  const p = ledgerPath(dir);
  mkdirSync(resolve(p, ".."), { recursive: true });
  const capped: SkillLedger = { applied: ledger.applied.slice(0, LEDGER_CAP) };
  writeFileAtomic(p, JSON.stringify(capped, null, 2) + "\n"); // atomic: a crash mid-write won't corrupt the rollback ledger
}

/** Inject/replace `provenance: agent` in the skill's frontmatter (wrap if absent). */
export function ensureAgentProvenance(name: string, body: string): string {
  const m = body.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) {
    // No frontmatter — synthesize a minimal one.
    return `---\nname: ${name}\nprovenance: agent\n---\n\n${body.trim()}\n`;
  }
  const head = m[1].split("\n").filter((l) => !/^provenance\s*:/i.test(l));
  head.push("provenance: agent");
  return `---\n${head.join("\n")}\n---\n${m[2] ?? ""}`;
}

export interface ApplySkillResult {
  applied: boolean;
  reason: string;
  path?: string;
  backup?: string | null;
}

/**
 * Write an agent-authored skill (threat-scanned, backed up, tagged, ledgered).
 * Returns applied:false with a reason instead of throwing on a refused/unsafe skill.
 */
export function applyAgentSkill(
  dir: string,
  skillsPath: string,
  name: string,
  body: string,
  opts: { evalScore?: number | null; now?: number } = {}
): ApplySkillResult {
  // Two-layer safety on autonomous skill content: prompt-injection patterns
  // (same scan as skill load) AND the destructive-command denylist. Both are
  // best-effort regex speed-bumps, NOT a boundary — a skill is instructions, so
  // the real guard is the runtime tool-deny gate (I-94). Defense-in-depth only.
  const threats = scanThreatPatterns(body);
  if (threats.length) {
    return { applied: false, reason: `refused: skill body failed threat scan (${threats.slice(0, 3).join("; ")})` };
  }
  if (isDestructive(body)) {
    return { applied: false, reason: "refused: skill body matches the destructive-command denylist" };
  }
  const safe = sanitizeSkillName(name);
  const root = skillWriteRoot(dir, skillsPath);
  mkdirSync(root, { recursive: true });
  const target = join(root, `${safe}.md`);

  const now = opts.now ?? Date.now();
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  let backup: string | null = null;
  if (existsSync(target)) {
    const backupDir = resolve(dir, loadConfig(dir).stateDir, "skill-backups");
    mkdirSync(backupDir, { recursive: true });
    backup = join(backupDir, `${safe}.${stamp}.md`);
    copyFileSync(target, backup);
  }

  writeFileAtomic(target, ensureAgentProvenance(safe, body), 0o644);

  const ledger = loadSkillLedger(dir);
  ledger.applied.unshift({
    name: safe,
    at: new Date(now).toISOString(),
    status: "applied",
    evalScore: opts.evalScore ?? null,
    backup,
  });
  saveSkillLedger(dir, ledger);
  return { applied: true, reason: backup ? "applied (prior version backed up)" : "applied (new skill)", path: target, backup };
}

export interface RollbackResult {
  ok: boolean;
  reason: string;
}

/** Reverse the latest apply of `name`: restore the backup, or remove a net-new skill. */
export function rollbackAgentSkill(dir: string, skillsPath: string, name: string): RollbackResult {
  const safe = sanitizeSkillName(name);
  const ledger = loadSkillLedger(dir);
  const entry = ledger.applied.find((e) => e.name === safe && e.status === "applied");
  if (!entry) return { ok: false, reason: `no applied skill '${safe}' to roll back` };

  const target = join(skillWriteRoot(dir, skillsPath), `${safe}.md`);
  let reason: string;
  if (entry.backup) {
    // Had a prior version: restore it. If the backup is gone, do NOT delete the
    // current skill (that would be lossy) — leave it and report.
    if (existsSync(entry.backup)) {
      copyFileSync(entry.backup, target);
      reason = "restored prior version";
    } else {
      reason = "cannot restore — backup missing; left current skill in place";
    }
  } else if (existsSync(target)) {
    rmSync(target); // net-new skill (no prior version) → remove
    reason = "removed net-new skill";
  } else {
    reason = "skill file already absent";
  }
  entry.status = "rolled-back";
  saveSkillLedger(dir, ledger);
  return { ok: true, reason };
}
