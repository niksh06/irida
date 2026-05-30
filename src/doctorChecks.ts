/**
 * Doctor checks as data (shared by CLI and TUI).
 */
import { accessSync, constants, existsSync } from "node:fs";
import { resolve } from "node:path";
import { CONFIG_FILE, ConfigError, loadConfig, validateMcpServers } from "./config.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function gatherDoctorChecks(dir: string = process.cwd()): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const key = (process.env.CURSOR_API_KEY ?? "").trim();
  checks.push({
    name: "CURSOR_API_KEY",
    ok: key.length > 0,
    detail: key.length > 0 ? "set" : "missing — export CURSOR_API_KEY=...",
  });

  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node >= 20", ok: major >= 20, detail: `v${process.versions.node}` });
  checks.push({ name: "cwd", ok: true, detail: dir });

  let cfgOk = true;
  let cfgDetail = `defaults (no ${CONFIG_FILE})`;
  let mcpErrs: string[] = [];
  let mcpCount = 0;
  try {
    const c = loadConfig(dir);
    if (existsSync(resolve(dir, CONFIG_FILE))) {
      cfgDetail = `loaded (model=${c.model}, runtime=${c.runtime})`;
    }
    mcpCount = Object.keys(c.mcpServers).length;
    mcpErrs = validateMcpServers(c.mcpServers);
  } catch (e) {
    cfgOk = false;
    cfgDetail = e instanceof ConfigError ? e.message : String(e);
  }
  checks.push({ name: "config", ok: cfgOk, detail: cfgDetail });
  if (cfgOk) {
    checks.push({
      name: "mcp config",
      ok: mcpErrs.length === 0,
      detail: mcpErrs.length ? mcpErrs.join("; ") : `${mcpCount} server(s), parse ok`,
    });
  }

  let writeOk = true;
  let writeDetail = "cwd writable (.agent created on first run)";
  const stateDir = resolve(dir, ".agent");
  const probeTarget = existsSync(stateDir) ? stateDir : dir;
  try {
    accessSync(probeTarget, constants.W_OK);
    if (existsSync(stateDir)) writeDetail = ".agent writable";
  } catch {
    writeOk = false;
    writeDetail = `${probeTarget} not writable`;
  }
  checks.push({ name: "state writable", ok: writeOk, detail: writeDetail });

  return checks;
}

export function doctorAllOk(checks: DoctorCheck[]): boolean {
  return checks.every((c) => c.ok);
}
