/**
 * cursor-lesson paired eval scaffold smoke (I-79) — tasks vs promote list, no live SDK.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateLessonEvalScaffold } from "../../../src/cursorLessonEval.js";

const caseDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(caseDir, "../../..");

export function runCursorLessonPairedSmoke(
  configDir: string = repoRoot,
  tasksPath: string = join(caseDir, "tasks.json")
): { ok: boolean; detail: string } {
  const r = validateLessonEvalScaffold(configDir, { tasksPath });
  if (!r.ok) {
    return { ok: false, detail: r.errors.join("; ") };
  }
  const warn =
    r.warnings.length > 0 ? ` warnings=${r.warnings.length}` : "";
  return { ok: true, detail: `tasks ok${warn}` };
}

async function main(): Promise<void> {
  const r = runCursorLessonPairedSmoke();
  if (!r.ok) {
    console.error(`cursor-lesson-paired FAIL: ${r.detail}`);
    process.exit(1);
  }
  console.log(`cursor-lesson-paired: ${r.detail}`);
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
