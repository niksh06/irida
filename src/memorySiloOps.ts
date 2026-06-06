/**
 * Memory silo alignment (issue 039 ops) — merge repo/cron silos into canonical root.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, resolveMemoryRoot } from "./config.js";
import { loadCronJobs } from "./cronJobs.js";

export interface MemorySilo {
  label: string;
  path: string;
  count: number;
}

export function gatherMemorySilos(dir: string): { canonical: string; silos: MemorySilo[] } {
  const canonical = resolve(resolveMemoryRoot(dir), "memory");
  const silos: MemorySilo[] = [];
  const home = process.env.CSAGENT_HOME?.trim();

  const repoMemory = resolve(dir, ".agent", "memory");
  if (home && canonical !== resolve(dir, ".agent") && existsSync(repoMemory)) {
    const count = countMd(repoMemory);
    if (count > 0) silos.push({ label: "repo", path: repoMemory, count });
  }

  if (home) {
    for (const job of loadCronJobs(dir)) {
      if (!job.cwd?.trim()) continue;
      const silo = resolve(job.cwd.trim(), ".agent", "memory");
      if (!existsSync(silo) || silo === canonical) continue;
      const count = countMd(silo);
      if (count > 0) {
        silos.push({ label: `cron:${job.id}`, path: silo, count });
      }
    }
  }

  return { canonical, silos };
}

function countMd(dir: string): number {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

export interface AlignSiloResult {
  copied: number;
  symlinked: string[];
  skipped: string[];
}

/** Copy missing notes to canonical; symlink silo dir → canonical/memory. */
export function alignMemorySilos(dir: string, dryRun = false): AlignSiloResult {
  const { canonical, silos } = gatherMemorySilos(dir);
  const result: AlignSiloResult = { copied: 0, symlinked: [], skipped: [] };
  if (!existsSync(canonical)) {
    if (!dryRun) mkdirSync(canonical, { recursive: true });
  }

  for (const silo of silos) {
    const files = readdirSync(silo.path).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const src = resolve(silo.path, f);
      const dest = resolve(canonical, f);
      if (existsSync(dest)) {
        result.skipped.push(f);
        continue;
      }
      if (!dryRun) {
        writeFileSync(dest, readFileSync(src, "utf8"), "utf8");
      }
      result.copied++;
    }
    const linkTarget = resolve(silo.path, ".csagent-canonical-memory");
    if (!dryRun) {
      try {
        if (!existsSync(linkTarget)) {
          symlinkSync(canonical, linkTarget);
        }
      } catch {
        /* non-fatal */
      }
    }
    result.symlinked.push(silo.path);
  }
  return result;
}

/** True when every .md in silo exists in canonical (post align-silo). */
export function siloIsAligned(siloPath: string, canonical: string): boolean {
  if (!existsSync(siloPath)) return true;
  const files = readdirSync(siloPath).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return true;
  if (!existsSync(canonical)) return false;
  return files.every((f) => existsSync(resolve(canonical, f)));
}
