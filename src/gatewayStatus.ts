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
  const rows = raw.trimEnd().split("\n").slice(-lines);
  return rows.join(" | ") || "(empty)";
}

export function gatherGatewayStatus(dir: string = process.cwd()): GatewayStatusLine[] {
  const rows: GatewayStatusLine[] = [];
  const home = process.env.CSAGENT_HOME?.trim() || resolve(dir, "..", "..");
  const logDir = resolve(home, "logs");
  const gwLog = resolve(logDir, "gateway.log");
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

  if (existsSync(gwLog)) {
    const ageMs = Date.now() - statSync(gwLog).mtimeMs;
    const tail = tailLog(gwLog, 3);
    const pollOk = tail.includes("long-poll started") || tail.includes("webhook listening");
    rows.push({
      name: "gateway log",
      ok: pollOk && ageMs < 7 * 24 * 60 * 60 * 1000,
      detail: `${Math.round(ageMs / 60_000)}m ago · ${tail.slice(0, 200)}`,
    });
  } else {
    rows.push({ name: "gateway log", ok: false, detail: gwLog });
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
