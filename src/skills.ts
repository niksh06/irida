/**
 * Local Markdown skills (PRD P0 Skills). Opt-in, injected as context — never
 * executed. Looks for `<skillsPath>/<name>.md` and `<skillsPath>/<name>/SKILL.md`.
 * Minimal frontmatter: name, description, tags.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, basename } from "node:path";

import { scanThreatPatterns } from "./promptThreatScan.js";

export interface Skill {
  name: string;
  description: string;
  tags: string[];
  content: string;
  path: string;
}

export class SkillError extends Error {}

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  tags: string[];
  body: string;
}

function parseFrontmatter(md: string): ParsedFrontmatter {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { tags: [], body: md };
  const head = m[1];
  const body = m[2] ?? "";
  const fm: ParsedFrontmatter = { tags: [], body };
  for (const line of head.split("\n")) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const val = kv[2].trim();
    if (key === "name") fm.name = stripQuotes(val);
    else if (key === "description") fm.description = stripQuotes(val);
    else if (key === "tags") fm.tags = parseTags(val);
  }
  return fm;
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

function parseTags(val: string): string[] {
  const inner = val.replace(/^\[|\]$/g, "");
  return inner
    .split(",")
    .map((t) => stripQuotes(t.trim()))
    .filter(Boolean);
}

/** Same candidate order as cron promptFile: config dir → CSAGENT_ROOT → cwd. */
export function resolveSkillsRoot(dir: string, skillsPath: string): string {
  const candidates: string[] = [resolve(dir, skillsPath)];
  const agentRoot = process.env.CSAGENT_ROOT?.trim();
  if (agentRoot) candidates.push(resolve(agentRoot, skillsPath));
  const cwd = process.cwd();
  if (cwd !== dir && cwd !== agentRoot) candidates.push(resolve(cwd, skillsPath));
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return candidates[0] ?? resolve(dir, skillsPath);
}

function candidateFiles(dir: string, skillsPath: string): string[] {
  const root = resolveSkillsRoot(dir, skillsPath);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const p = join(root, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isFile() && entry.toLowerCase().endsWith(".md")) out.push(p);
    else if (st.isDirectory()) {
      const skillMd = join(p, "SKILL.md");
      if (existsSync(skillMd)) out.push(skillMd);
    }
  }
  return out;
}

function toSkill(path: string): Skill {
  const raw = readFileSync(path, "utf8");
  const fm = parseFrontmatter(raw);
  const fallbackName =
    basename(path).toLowerCase() === "skill.md"
      ? basename(resolve(path, ".."))
      : basename(path).replace(/\.md$/i, "");
  return {
    name: fm.name || fallbackName,
    description: fm.description || "",
    tags: fm.tags,
    content: fm.body.trim(),
    path,
  };
}

export function listSkills(dir: string, skillsPath: string): Skill[] {
  const out: Skill[] = [];
  for (const p of candidateFiles(dir, skillsPath)) {
    try {
      out.push(toSkill(p));
    } catch {
      // unreadable or invalid skill file — skip
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Case-insensitive search across name, description, and tags. */
export function searchSkills(dir: string, skillsPath: string, query: string): Skill[] {
  const q = query.trim().toLowerCase();
  const all = listSkills(dir, skillsPath);
  if (!q) return all;
  return all.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
  );
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export function suggestSkillNames(all: Skill[], want: string, max = 3): string[] {
  const w = want.trim().toLowerCase();
  if (!w || all.length === 0) return [];
  return all
    .map((s) => ({ name: s.name, d: editDistance(s.name.toLowerCase(), w) }))
    .sort((a, b) => a.d - b.d)
    .filter((x) => x.d <= Math.max(3, Math.floor(w.length / 2)))
    .slice(0, max)
    .map((x) => x.name);
}

export function scanSkillThreat(skill: Skill, allowUnsafe: string[] = []): string[] {
  if (allowUnsafe.some((a) => a.toLowerCase() === skill.name.toLowerCase())) return [];
  return scanThreatPatterns(skill.content);
}

export function loadSkill(
  dir: string,
  skillsPath: string,
  name: string,
  opts?: { allowUnsafe?: string[] }
): Skill {
  const all = listSkills(dir, skillsPath);
  const want = name.trim().toLowerCase();
  const hit = all.find((s) => s.name.toLowerCase() === want);
  if (!hit) {
    const avail = all.map((s) => s.name).join(", ") || "(none)";
    const hints = suggestSkillNames(all, name);
    const didYouMean = hints.length ? ` Did you mean: ${hints.join(", ")}?` : "";
    throw new SkillError(`skill '${name}' not found. Available: ${avail}.${didYouMean}`);
  }
  const hits = scanSkillThreat(hit, opts?.allowUnsafe ?? []);
  if (hits.length) {
    throw new SkillError(`skill '${name}' failed threat scan`);
  }
  return hit;
}

export function loadSkills(
  dir: string,
  skillsPath: string,
  names: string[],
  opts?: { allowUnsafe?: string[] }
): Skill[] {
  return names.map((n) => loadSkill(dir, skillsPath, n, opts));
}

export function skillExists(dir: string, skillsPath: string, name: string): boolean {
  const want = name.trim().toLowerCase();
  return listSkills(dir, skillsPath).some((s) => s.name.toLowerCase() === want);
}
