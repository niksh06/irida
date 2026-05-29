/**
 * `cursor-agent doctor` — validate the minimum needed for a local SDK run
 * (issue 004). Never prints secret values.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONFIG_FILE, ConfigError, loadConfig, validateMcpServers } from "./config.js";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export function cmdDoctor(dir: string = process.cwd()): number {
  const checks: Check[] = [];

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
  let writeDetail = "writable";
  try {
    const stateDir = resolve(dir, ".agent");
    mkdirSync(stateDir, { recursive: true });
    const probe = resolve(stateDir, ".probe");
    writeFileSync(probe, "x");
    rmSync(probe);
  } catch (e) {
    writeOk = false;
    writeDetail = (e as Error).message;
  }
  checks.push({ name: ".agent writable", ok: writeOk, detail: writeDetail });

  let allOk = true;
  for (const c of checks) {
    if (!c.ok) allOk = false;
    console.log(`${c.ok ? "OK  " : "FAIL"}  ${c.name}: ${c.detail}`);
  }
  console.log(allOk ? "\ndoctor: all checks passed" : "\ndoctor: some checks failed");
  return allOk ? 0 : 1;
}
