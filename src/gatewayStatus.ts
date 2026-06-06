/**
 * `csagent gateway status` — launchd + log probe (I-18).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { gatewayConfigPath, loadGatewayConfig } from "./gatewayConfig.js";

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

function tailLog(path: string, lines = 5): string {
  if (!existsSync(path)) return "(log missing)";
  const raw = readFileSync(path, "utf8");
  const rows = raw.trimEnd().split("\n").filter(Boolean).slice(-lines);
  return rows.join(" | ") || "(empty)";
}

/** launchd: stdout → gateway.log, stderr (console.error) → gateway.error.log */
function resolveGatewayLogPath(logDir: string): { path: string; stream: "stderr" | "stdout" } | null {
  const errLog = resolve(logDir, "gateway.error.log");
  const outLog = resolve(logDir, "gateway.log");
  if (existsSync(errLog) && statSync(errLog).size > 0) {
    return { path: errLog, stream: "stderr" };
  }
  if (existsSync(outLog) && statSync(outLog).size > 0) {
    return { path: outLog, stream: "stdout" };
  }
  if (existsSync(errLog)) return { path: errLog, stream: "stderr" };
  if (existsSync(outLog)) return { path: outLog, stream: "stdout" };
  return null;
}

function gatewayLogHealthy(tail: string, ageMs: number, gatewayRunning: boolean): boolean {
  const started = tail.includes("long-poll started") || tail.includes("webhook listening");
  const recent = ageMs < 7 * 24 * 60 * 60 * 1000;
  if (gatewayRunning) {
    return recent || started || (tail !== "(empty)" && tail !== "(log missing)");
  }
  return started && recent;
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

  const gwLogProbe = resolveGatewayLogPath(logDir);
  if (gwLogProbe) {
    const ageMs = Date.now() - statSync(gwLogProbe.path).mtimeMs;
    const tail = tailLog(gwLogProbe.path, 3);
    rows.push({
      name: "gateway log",
      ok: gatewayLogHealthy(tail, ageMs, gwLaunch.ok),
      detail: `${gwLogProbe.stream} · ${Math.round(ageMs / 60_000)}m ago · ${tail.slice(0, 200)}`,
    });
  } else {
    rows.push({
      name: "gateway log",
      ok: false,
      detail: `no logs in ${logDir} (expected gateway.error.log)`,
    });
  }

  if (existsSync(cronLog)) {
    const tail = tailLog(cronLog, 2);
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
