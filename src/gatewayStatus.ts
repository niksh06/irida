/**
 * `csagent gateway status` — launchd + log probe (I-18).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { gatewayConfigPath, loadGatewayConfig } from "./gatewayConfig.js";
import { assessGatewayServiceHealth, tailLogLines } from "./gatewayLogHealth.js";

export interface GatewayStatusLine {
  name: string;
  ok: boolean;
  detail: string;
}

const GATEWAY_LABEL = "ai.csagent.gateway";
const CRON_LABEL = "ai.csagent.cron-tick";

function launchdRunning(label: string): { ok: boolean; detail: string } {
  try {
    const out = execSync("launchctl list", { encoding: "utf8", timeout: 5000 });
    for (const line of out.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3 && parts[parts.length - 1] === label) {
        const pid = parts[0];
        const code = parts[1];
        if (pid === "-" || pid === "0") {
          if (label === CRON_LABEL && code === "0") {
            return { ok: true, detail: "interval job idle (last exit 0)" };
          }
          return { ok: false, detail: `loaded but not running (last exit ${code})` };
        }
        return { ok: true, detail: `pid ${pid}` };
      }
    }
    return { ok: false, detail: "not loaded in launchctl" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

function readLogTailLines(path: string, lines = 5): string[] {
  if (!existsSync(path)) return [];
  return tailLogLines(readFileSync(path, "utf8"), lines);
}

function logAgeMs(path: string): number {
  return existsSync(path) ? Date.now() - statSync(path).mtimeMs : Number.POSITIVE_INFINITY;
}

export function gatherGatewayStatus(dir: string = process.cwd()): GatewayStatusLine[] {
  const rows: GatewayStatusLine[] = [];
  const home = process.env.CSAGENT_HOME?.trim() || resolve(dir, "..", "..");
  const logDir = resolve(home, "logs");
  const cronLog = resolve(logDir, "cron-tick.log");

  const gwPath = gatewayConfigPath(dir);
  if (existsSync(gwPath)) {
    try {
      const cfg = loadGatewayConfig(dir);
      rows.push({
        name: "gateway config",
        ok: true,
        detail: `${cfg.adapter} · ${cfg.allowedChatIds.length} peer(s)`,
      });
    } catch (e) {
      rows.push({
        name: "gateway config",
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    rows.push({ name: "gateway config", ok: false, detail: "gateway.json missing" });
  }

  const gwLaunch = launchdRunning(GATEWAY_LABEL);
  rows.push({ name: "launchd gateway", ok: gwLaunch.ok, detail: gwLaunch.detail });

  const cronLaunch = launchdRunning(CRON_LABEL);
  rows.push({ name: "launchd cron-tick", ok: cronLaunch.ok, detail: cronLaunch.detail });

  const infoLog = resolve(logDir, "gateway.log");
  const errLog = resolve(logDir, "gateway.error.log");
  if (existsSync(infoLog) || existsSync(errLog)) {
    const health = assessGatewayServiceHealth({
      infoLines: readLogTailLines(infoLog, 8),
      errorLines: readLogTailLines(errLog, 5),
      infoAgeMs: logAgeMs(infoLog),
      errorAgeMs: logAgeMs(errLog),
      gatewayRunning: gwLaunch.ok,
    });
    rows.push({
      name: "gateway health",
      ok: health.ok,
      detail: health.hint ? `${health.detail} → ${health.hint}` : health.detail,
    });
  } else {
    rows.push({
      name: "gateway health",
      ok: false,
      detail: `no logs in ${logDir} (expected gateway.log)`,
    });
  }

  if (existsSync(cronLog)) {
    const tail = readLogTailLines(cronLog, 2).join(" | ") || "(empty)";
    rows.push({ name: "cron log", ok: true, detail: tail.slice(0, 160) });
  }

  const cfg = loadConfig(dir);
  const cronPath = resolve(dir, cfg.stateDir, "cron.jobs.json");
  rows.push({
    name: "cron jobs",
    ok: existsSync(cronPath),
    detail: existsSync(cronPath) ? cronPath : "cron.jobs.json missing",
  });

  return rows;
}
