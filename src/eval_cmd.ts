/**
 * Eval battery scaffold (I-49) — external verify scripts, no live SDK in CI.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { EXIT } from "./exit.js";

export interface EvalCase {
  id: string;
  promptFile?: string;
  verify: string;
}

export interface EvalManifest {
  version: number;
  cases: EvalCase[];
}

export function evalRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "eval");
}

export function loadEvalManifest(root: string = evalRoot()): EvalManifest {
  const path = resolve(root, "manifest.json");
  if (!existsSync(path)) throw new Error(`eval manifest missing: ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<EvalManifest>;
  if (!Array.isArray(parsed.cases)) throw new Error("eval manifest.cases must be an array");
  const cases: EvalCase[] = [];
  for (const raw of parsed.cases as unknown[]) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const verify = typeof o.verify === "string" ? o.verify.trim() : "";
    if (!id || !verify) continue;
    const c: EvalCase = { id, verify };
    if (typeof o.promptFile === "string" && o.promptFile.trim()) {
      c.promptFile = o.promptFile.trim();
    }
    cases.push(c);
  }
  if (!cases.length) throw new Error("eval manifest has no valid cases");
  return { version: typeof parsed.version === "number" ? parsed.version : 1, cases };
}

export function runEvalCase(caseId: string, root: string = evalRoot()): { ok: boolean; detail: string } {
  const manifest = loadEvalManifest(root);
  const c = manifest.cases.find((x) => x.id === caseId);
  if (!c) return { ok: false, detail: `case '${caseId}' not found` };

  const caseDir = resolve(root, "cases", c.id);
  const verifyPath = resolve(caseDir, c.verify);
  if (!existsSync(verifyPath)) return { ok: false, detail: `verify script missing: ${verifyPath}` };

  const run = spawnSync("bash", [verifyPath], {
    cwd: caseDir,
    encoding: "utf8",
    env: { ...process.env, EVAL_ROOT: root, EVAL_CASE_DIR: caseDir },
  });
  if (run.status === 0) {
    return { ok: true, detail: run.stdout.trim() || "verify ok" };
  }
  return {
    ok: false,
    detail: (run.stderr || run.stdout || `verify exit ${run.status}`).trim().slice(0, 500),
  };
}

export function runEvalBattery(
  root: string = evalRoot(),
  onlyCase?: string
): { ok: boolean; results: Array<{ id: string; ok: boolean; detail: string }> } {
  const manifest = loadEvalManifest(root);
  const cases = onlyCase ? manifest.cases.filter((c) => c.id === onlyCase) : manifest.cases;
  if (onlyCase && cases.length === 0) {
    return { ok: false, results: [{ id: onlyCase, ok: false, detail: "case not found" }] };
  }
  const results = cases.map((c) => {
    const r = runEvalCase(c.id, root);
    return { id: c.id, ok: r.ok, detail: r.detail };
  });
  return { ok: results.every((r) => r.ok), results };
}

export async function cmdEval(argv: string[]): Promise<number> {
  const [sub, arg] = argv;
  if (sub === "list") {
    const manifest = loadEvalManifest();
    for (const c of manifest.cases) {
      console.log(`${c.id}\t${c.verify}${c.promptFile ? `\t${c.promptFile}` : ""}`);
    }
    return EXIT.ok;
  }
  const onlyCase = sub === "run" ? arg : sub || undefined;
  const r = runEvalBattery(evalRoot(), onlyCase);
  for (const row of r.results) {
    console.log(`${row.ok ? "PASS" : "FAIL"} ${row.id}: ${row.detail}`);
  }
  return r.ok ? EXIT.ok : EXIT.software;
}
