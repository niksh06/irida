/**
 * `cursor-agent doctor` — validate the minimum needed for a local SDK run
 * (issue 004). Never prints secret values.
 */
import { gatherDoctorChecks, gatherDoctorApiChecks, doctorAllOk, type ModelsListFn } from "./doctorChecks.js";

export async function cmdDoctor(
  dir: string = process.cwd(),
  opts?: { listModels?: ModelsListFn }
): Promise<number> {
  const checks = [...gatherDoctorChecks(dir), ...(await gatherDoctorApiChecks(dir, opts))];
  for (const c of checks) {
    console.log(`${c.ok ? "OK  " : "FAIL"}  ${c.name}: ${c.detail}`);
  }
  const allOk = doctorAllOk(checks);
  console.log(allOk ? "\ndoctor: all checks passed" : "\ndoctor: some checks failed");
  return allOk ? 0 : 1;
}

export { gatherDoctorChecks, gatherDoctorApiChecks, doctorAllOk };
