/**
 * Doctor checks as data (shared by CLI and TUI).
 */
import { accessSync, constants, existsSync } from "node:fs";
import { resolve } from "node:path";
import { CONFIG_FILE, ConfigError, loadConfig, validateMcpServers } from "./config.js";
import { resolveMcpServers } from "./mcpServers.js";
import { resolveApiKey, apiKeySourceLabel } from "./credentials.js";
import { probePostgresStore } from "./store.js";
import { validateCronJobsFile, cronJobsPath } from "./cronJobs.js";
import { validateGatewayConfig, gatewayConfigPath } from "./gatewayConfig.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function gatherDoctorChecks(dir: string = process.cwd()): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const resolved = resolveApiKey(dir);
  checks.push({
    name: "CURSOR_API_KEY",
    ok: resolved.key.length > 0,
    detail: apiKeySourceLabel(resolved.source, dir),
  });

  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node >= 20", ok: major >= 20, detail: `v${process.versions.node}` });
  checks.push({ name: "cwd", ok: true, detail: dir });
  const home = process.env.CSAGENT_HOME?.trim();
  if (home) {
    checks.push({ name: "CSAGENT_HOME", ok: true, detail: home });
  }

  let cfgOk = true;
  let cfgDetail = `defaults (no ${CONFIG_FILE})`;
  let mcpErrs: string[] = [];
  let mcpCount = 0;
  try {
    const c = loadConfig(dir);
    if (existsSync(resolve(dir, CONFIG_FILE))) {
      cfgDetail = `loaded (model=${c.model}, runtime=${c.runtime})`;
    }
    const merged = resolveMcpServers(c, dir);
    mcpCount = Object.keys(merged).length;
    mcpErrs = validateMcpServers(merged);
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
  let writeDetail = "state dir writable (created on first run)";
  let stateRoot = dir;
  try {
    stateRoot = resolve(dir, loadConfig(dir).stateDir);
  } catch {
    stateRoot = resolve(dir, ".agent");
  }
  const probeTarget = existsSync(stateRoot) ? stateRoot : dir;
  try {
    accessSync(probeTarget, constants.W_OK);
    if (existsSync(stateRoot)) writeDetail = `${stateRoot} writable`;
  } catch {
    writeOk = false;
    writeDetail = `${probeTarget} not writable`;
  }
  checks.push({ name: "state writable", ok: writeOk, detail: writeDetail });

  const cronPath = cronJobsPath(dir);
  if (existsSync(cronPath)) {
    const cronErrs = validateCronJobsFile(dir);
    checks.push({
      name: "cron jobs",
      ok: cronErrs.length === 0,
      detail: cronErrs.length ? cronErrs.join("; ") : "cron.jobs.json valid",
    });
  }

  const gwPath = gatewayConfigPath(dir);
  if (existsSync(gwPath)) {
    const gwErrs = validateGatewayConfig(dir);
    checks.push({
      name: "gateway",
      ok: gwErrs.length === 0,
      detail: gwErrs.length ? gwErrs.join("; ") : "gateway.json valid",
    });
  }

  return checks;
}

export function doctorAllOk(checks: DoctorCheck[]): boolean {
  return checks.every((c) => c.ok);
}

export type ModelsListFn = (opts: { apiKey: string }) => Promise<Array<{ id?: string }>>;

export async function gatherDoctorStoreChecks(_dir: string = process.cwd()): Promise<DoctorCheck[]> {
  const url = process.env.CSAGENT_DATABASE_URL?.trim();
  if (!url) {
    return [{ name: "store", ok: true, detail: "sqlite (CSAGENT_DATABASE_URL unset)" }];
  }
  const probe = await probePostgresStore(url);
  return [{ name: "CSAGENT_DATABASE_URL", ok: probe.ok, detail: probe.detail }];
}

/** Tier-1 Cursor API probe (models list). Skipped when key is unset. */
export async function gatherDoctorApiChecks(
  dir: string = process.cwd(),
  deps?: { listModels?: ModelsListFn }
): Promise<DoctorCheck[]> {
  void dir;
  const resolved = resolveApiKey(dir);
  const key = resolved.key;
  if (!key) return [];

  const listModels =
    deps?.listModels ??
    (async (opts: { apiKey: string }) => {
      const { Cursor } = await import("@cursor/sdk");
      return Cursor.models.list(opts);
    });

  try {
    const list = await listModels({ apiKey: key });
    const count = list.filter((m) => typeof m.id === "string" && m.id.trim()).length;
    if (count === 0) {
      return [{ name: "Cursor API (models)", ok: false, detail: "empty model list" }];
    }
    return [{ name: "Cursor API (models)", ok: true, detail: `${count} model(s) visible` }];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    const detail =
      lower.includes("fetch") || lower.includes("network") || lower.includes("econnrefused")
        ? `network error — ${msg}`
        : msg.includes("Authentication") || lower.includes("unauthenticated") || lower.includes("not logged in")
          ? `authentication failed — refresh CURSOR_API_KEY in Cursor Integrations`
          : msg;
    return [{ name: "Cursor API (models)", ok: false, detail }];
  }
}
