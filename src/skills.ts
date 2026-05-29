/**
 * Local Markdown skills (PRD P0 Skills). Opt-in, injected as context — never
 * executed. Looks for `<skillsPath>/<name>.md` and `<skillsPath>/<name>/SKILL.md`.
 * Minimal frontmatter: name, description, tags.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, basename } from "node:path";

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

function candidateFiles(dir: string, skillsPath: string): string[] {
  const root = resolve(dir, skillsPath);
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
  return candidateFiles(dir, skillsPath).map(toSkill);
}

export function loadSkill(dir: string, skillsPath: string, name: string): Skill {
  const all = listSkills(dir, skillsPath);
  const want = name.trim().toLowerCase();
  const hit = all.find((s) => s.name.toLowerCase() === want);
  if (!hit) {
    const avail = all.map((s) => s.name).join(", ") || "(none)";
    throw new SkillError(`skill '${name}' not found. Available: ${avail}`);
  }
  return hit;
}

export function loadSkills(dir: string, skillsPath: string, names: string[]): Skill[] {
  return names.map((n) => loadSkill(dir, skillsPath, n));
}
