/**
 * `cursor-agent doctor` — validate the minimum needed for a local SDK run
 * (issue 004). Never prints secret values.
 */
import { gatherDoctorChecks, doctorAllOk } from "./doctorChecks.js";

export function cmdDoctor(dir: string = process.cwd()): number {
  const checks = gatherDoctorChecks(dir);
  for (const c of checks) {
    console.log(`${c.ok ? "OK  " : "FAIL"}  ${c.name}: ${c.detail}`);
  }
  const allOk = doctorAllOk(checks);
  console.log(allOk ? "\ndoctor: all checks passed" : "\ndoctor: some checks failed");
  return allOk ? 0 : 1;
}

export { gatherDoctorChecks, doctorAllOk };
