import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".agent"]);

export interface ContextRefPrefix {
  kind: "file" | "dir";
  prefix: string;
  tokenStart: number;
}

/** Active @file: or @dir: token ending at cursor (or end of input). */
export function parseContextRefPrefix(input: string, cursor?: number): ContextRefPrefix | null {
  const end = cursor ?? input.length;
  const before = input.slice(0, end);
  const m = before.match(/@(file|dir):([^\s]*)$/);
  if (!m || m.index == null) return null;
  return {
    kind: m[1] as "file" | "dir",
    prefix: m[2] ?? "",
    tokenStart: m.index,
  };
}

export function applyContextRefCompletion(input: string, ref: ContextRefPrefix, completed: string): string {
  const head = input.slice(0, ref.tokenStart);
  const rest = input.slice(ref.tokenStart);
  const replaced = rest.replace(/^@(file|dir):[^\s]*/, `@${ref.kind}:${completed}`);
  return head + replaced;
}

export function commonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  if (paths.length === 1) return paths[0]!;
  let prefix = paths[0]!;
  for (const p of paths.slice(1)) {
    while (!p.startsWith(prefix) && prefix.length > 0) {
      prefix = prefix.slice(0, -1);
    }
  }
  return prefix;
}

/** List workspace paths matching partial @file / @dir token. */
export function completeContextRef(
  cwd: string,
  kind: "file" | "dir",
  prefix: string,
  limit = 24
): string[] {
  const normCwd = resolve(cwd);
  const clean = prefix.replace(/^['"]|['"]$/g, "");
  const slash = clean.lastIndexOf("/");
  const dirPart = slash >= 0 ? clean.slice(0, slash) : "";
  const leaf = slash >= 0 ? clean.slice(slash + 1) : clean;

  let baseDir: string;
  try {
    baseDir = resolve(normCwd, dirPart || ".");
    const rel = relative(normCwd, baseDir);
    if (rel.startsWith("..")) return [];
  } catch {
    return [];
  }

  if (!existsSync(baseDir)) return [];

  const out: string[] = [];
  collectMatches(baseDir, dirPart, leaf, kind, out, limit, 0);
  return out.sort();
}

function collectMatches(
  absDir: string,
  relDir: string,
  leaf: string,
  kind: "file" | "dir",
  out: string[],
  limit: number,
  depth: number
): void {
  if (out.length >= limit || depth > 4) return;
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return;
  }

  for (const name of entries.sort()) {
    if (out.length >= limit) break;
    if (name.startsWith(".") && name !== ".") continue;
    const abs = join(absDir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    const relPath = relDir ? `${relDir}/${name}` : name;
    const isDir = st.isDirectory();

    if (isDir) {
      if (kind === "dir" && name.toLowerCase().startsWith(leaf.toLowerCase())) {
        out.push(relPath);
      }
      if (!SKIP_DIRS.has(name) && (leaf === "" || name.toLowerCase().startsWith(leaf.toLowerCase()))) {
        collectMatches(abs, relPath, "", kind, out, limit, depth + 1);
      }
    } else if (kind === "file" && name.toLowerCase().startsWith(leaf.toLowerCase())) {
      out.push(relPath);
    }
  }
}
