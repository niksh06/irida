/**
 * Warn when dist/ is older than src/ for memory search modules (I-71).
 */
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { DoctorCheck } from "./doctorChecks.js";

const CRITICAL_DIST_PAIRS = [
  ["src/memoryStore.ts", "dist/memoryStore.js"],
  ["src/memorySearchPolicy.ts", "dist/memorySearchPolicy.js"],
] as const;

export function gatherStaleDistChecks(dir: string): DoctorCheck[] {
  const stale: string[] = [];
  let checked = 0;
  for (const [srcRel, distRel] of CRITICAL_DIST_PAIRS) {
    const src = resolve(dir, srcRel);
    const dist = resolve(dir, distRel);
    if (!existsSync(src) || !existsSync(dist)) continue;
    checked++;
    if (statSync(src).mtimeMs > statSync(dist).mtimeMs) {
      stale.push(srcRel.replace(/^src\//, ""));
    }
  }
  if (checked === 0) {
    return [];
  }
  if (stale.length === 0) {
    return [{ name: "dist freshness", ok: true, detail: "memory search modules built" }];
  }
  return [
    {
      name: "dist freshness",
      ok: false,
      detail: `stale dist for ${stale.join(", ")} — wing exclude (I-62) may be missing in dist/`,
      fix: "npm run build",
    },
  ];
}
