/**
 * Bulk import HappyIn KB markdown into csagent-memory (variant B: 1 note per article).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { loadConfig } from "./config.js";
import { saveMemory } from "./memory.js";
import { createMemoryStore } from "./memoryStore.js";
import { nowIso } from "./util.js";

export const KB_EXCLUDE_DIRS = new Set([
  "blog",
  "assets",
  "javascripts",
  "stylesheets",
  "contributing",
]);

const MAX_NOTE_NAME_LEN = 64;

function sanitizeSlug(slug: string): string {
  const cleaned = slug
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return cleaned || "article";
}

export interface ImportHappyinOptions {
  /** Root of agent_tutorial / knowledge-space docs mirror. */
  kbRoot: string;
  /** csagent memory root (usually same as kbRoot). */
  memoryDir?: string;
  stateDir?: string;
  /** Git commit from .kb-sync; auto-read when omitted. */
  commit?: string;
  dryRun?: boolean;
}

export interface ImportHappyinResult {
  imported: number;
  skipped: number;
  commit: string;
  aliases: number;
}

/** Stable note name: domain.slug (global PK); sanitize slug; truncate when > 64 chars. */
export function makeNoteName(domain: string, slug: string): string {
  const safeSlug = sanitizeSlug(slug);
  const full = `${domain}.${safeSlug}`;
  if (full.length <= MAX_NOTE_NAME_LEN) return full;
  const budget = MAX_NOTE_NAME_LEN - domain.length - 1;
  let truncated = safeSlug.slice(0, budget).replace(/[._-]+$/, "");
  if (!truncated) truncated = safeSlug.slice(0, budget);
  return `${domain}.${truncated}`;
}

function readKbSyncCommit(kbRoot: string): string {
  const path = join(kbRoot, ".kb-sync");
  if (!existsSync(path)) return "unknown";
  const line = readFileSync(path, "utf8").trim().split(/\s+/)[0];
  return line || "unknown";
}

function listKbMarkdownFiles(kbRoot: string): Array<{ domain: string; relPath: string; slug: string }> {
  const out: Array<{ domain: string; relPath: string; slug: string }> = [];

  for (const entry of readdirSync(kbRoot).sort()) {
    if (KB_EXCLUDE_DIRS.has(entry)) continue;
    const abs = join(kbRoot, entry);
    if (!statSync(abs).isDirectory()) continue;
    walkDomain(kbRoot, entry, abs, out);
  }

  for (const entry of readdirSync(kbRoot).sort()) {
    if (entry.endsWith(".md")) {
      const slug = basename(entry, ".md");
      out.push({ domain: "meta", relPath: entry, slug });
    }
  }

  return out;
}

function walkDomain(
  kbRoot: string,
  domain: string,
  dir: string,
  out: Array<{ domain: string; relPath: string; slug: string }>
): void {
  for (const entry of readdirSync(dir).sort()) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) continue;
    if (extname(entry).toLowerCase() !== ".md") continue;
    const relPath = relative(kbRoot, abs);
    out.push({ domain, relPath, slug: basename(entry, ".md") });
  }
}

function noteBody(relPath: string, commit: string, raw: string): string {
  return `<!-- kb: ${relPath} @ ${commit} -->\n\n${raw.trim()}\n`;
}

export async function importHappyinKb(opts: ImportHappyinOptions): Promise<ImportHappyinResult> {
  const kbRoot = opts.kbRoot;
  const memoryDir = opts.memoryDir ?? kbRoot;
  const cfg = loadConfig(memoryDir);
  const stateDir = opts.stateDir ?? cfg.stateDir;
  const commit = opts.commit?.trim() || readKbSyncCommit(kbRoot);
  const files = listKbMarkdownFiles(kbRoot);

  if (opts.dryRun) {
    let aliases = 0;
    for (const f of files) {
      const name = makeNoteName(f.domain, f.slug);
      if (name !== `${f.domain}.${f.slug}`) aliases++;
    }
    return { imported: files.length, skipped: 0, commit, aliases };
  }

  const store = createMemoryStore(memoryDir, stateDir);
  let imported = 0;
  let aliases = 0;

  try {
    for (const f of files) {
      const abs = join(kbRoot, f.relPath);
      const raw = readFileSync(abs, "utf8");
      const name = makeNoteName(f.domain, f.slug);
      const canonical = `${f.domain}.${sanitizeSlug(f.slug)}`;
      if (name !== canonical || sanitizeSlug(f.slug) !== f.slug) {
        aliases++;
        await store.addFact({
          subject: "happyin_alias",
          predicate: canonical,
          object: name,
          source: "import-happyin-kb",
        });
      }
      const body = noteBody(f.relPath, commit, raw);
      await store.upsertNote({ name, body, wing: f.domain });
      saveMemory(memoryDir, name, body);
      imported++;
    }

    await store.addFact({
      subject: "happyin_kb",
      predicate: "commit",
      object: commit,
      source: "import-happyin-kb",
    });
    await store.addFact({
      subject: "happyin_kb",
      predicate: "articles",
      object: String(imported),
      source: "import-happyin-kb",
    });
    await store.addFact({
      subject: "happyin_kb",
      predicate: "synced_at",
      object: nowIso(),
      source: "import-happyin-kb",
    });
  } finally {
    await store.close();
  }

  return { imported, skipped: 0, commit, aliases };
}
