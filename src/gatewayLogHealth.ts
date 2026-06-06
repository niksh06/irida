/**
 * Interpret gateway.error.log tail for `gateway status` health (not just file presence).
 */

/** Always-on gateway should append to stderr at least this often (poll loop or heartbeat). */
export const GATEWAY_LOG_STALE_MS = 60 * 60 * 1000;

export interface GatewayLogHealth {
  ok: boolean;
  detail: string;
  hint?: string;
}

export function tailLogLines(raw: string, lines = 5): string[] {
  return raw
    .trimEnd()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-lines);
}

export function assessGatewayLogHealth(opts: {
  tailLines: string[];
  ageMs: number;
  gatewayRunning: boolean;
  stream: "stderr" | "stdout";
}): GatewayLogHealth {
  const { tailLines, ageMs, gatewayRunning, stream } = opts;
  const ageMin = Math.round(ageMs / 60_000);
  const gwLines = tailLines.filter((l) => l.includes("[gateway]"));
  const tailPreview = (gwLines.length ? gwLines : tailLines).join(" | ").slice(0, 200);

  if (tailLines.length === 0) {
    return {
      ok: !gatewayRunning,
      detail: `${stream} · empty`,
      hint: gatewayRunning ? "restart: bash ~/.csagent/csagent/deploy/install-launchd.sh" : undefined,
    };
  }

  if (gatewayRunning && ageMs > GATEWAY_LOG_STALE_MS) {
    return {
      ok: false,
      detail: `${stream} · stale ${ageMin}m · ${tailPreview}`,
      hint: "log not updating — gateway likely stuck; bash ~/.csagent/csagent/deploy/install-launchd.sh",
    };
  }

  if (gwLines.length > 0) {
    const lastGw = gwLines[gwLines.length - 1]!;
    if (lastGw.includes("poll error")) {
      return {
        ok: false,
        detail: `${stream} · ${ageMin}m ago · ${tailPreview}`,
        hint: "telegram poll failing — restart gateway; check Hermes 409 / rate limits",
      };
    }
    if (lastGw.includes("long-poll started") || lastGw.includes("poll ok")) {
      return { ok: true, detail: `${stream} · ${ageMin}m ago · ${tailPreview}` };
    }
  }

  const recentGw = gwLines.slice(-3);
  if (
    recentGw.length > 0 &&
    recentGw.every((l) => l.includes("poll error"))
  ) {
    return {
      ok: false,
      detail: `${stream} · ${ageMin}m ago · ${tailPreview}`,
      hint: "telegram poll failing — restart gateway; check Hermes 409 / rate limits",
    };
  }

  const ok = !gatewayRunning || ageMs <= GATEWAY_LOG_STALE_MS;
  return {
    ok,
    detail: `${stream} · ${ageMin}m ago · ${tailPreview}`,
    hint: ok ? undefined : "restart gateway",
  };
}

/** Combined launchd stdout (ops) + stderr (errors) health. */
export function assessGatewayServiceHealth(opts: {
  infoLines: string[];
  errorLines: string[];
  infoAgeMs: number;
  errorAgeMs: number;
  gatewayRunning: boolean;
}): GatewayLogHealth {
  const { infoLines, errorLines, infoAgeMs, errorAgeMs, gatewayRunning } = opts;
  const infoGw = infoLines.filter((l) => l.includes("[gateway]") || l.includes("[chat]"));
  const errGw = errorLines.filter((l) => l.includes("[gateway]"));

  if (gatewayRunning && infoAgeMs > GATEWAY_LOG_STALE_MS && errorAgeMs > GATEWAY_LOG_STALE_MS) {
    return {
      ok: false,
      detail: `stdout stale ${Math.round(infoAgeMs / 60_000)}m · stderr ${Math.round(errorAgeMs / 60_000)}m`,
      hint: "no log activity — restart: bash ~/.csagent/csagent/deploy/install-launchd.sh",
    };
  }

  if (errGw.length > 0) {
    const lastErr = errGw[errGw.length - 1]!;
    if (lastErr.includes("poll error") && errorAgeMs < GATEWAY_LOG_STALE_MS) {
      return {
        ok: false,
        detail: `stderr · ${Math.round(errorAgeMs / 60_000)}m ago · ${lastErr.slice(0, 160)}`,
        hint: "telegram poll errors — check rate limits / Hermes 409",
      };
    }
  }

  const lastInfo = infoGw[infoGw.length - 1] ?? "";
  const infoRecent = infoAgeMs <= GATEWAY_LOG_STALE_MS;
  const healthyInfo =
    lastInfo.includes("poll ok") ||
    lastInfo.includes("long-poll started") ||
    lastInfo.includes("sendTurn ok") ||
    lastInfo.includes("[chat]");

  if (gatewayRunning && infoRecent && healthyInfo) {
    return {
      ok: true,
      detail: `stdout · ${Math.round(infoAgeMs / 60_000)}m ago · ${lastInfo.slice(0, 160)}`,
    };
  }

  return assessGatewayLogHealth({
    tailLines: infoLines.length ? infoLines : errorLines,
    ageMs: Math.min(infoAgeMs, errorAgeMs),
    gatewayRunning,
    stream: infoLines.length ? "stdout" : "stderr",
  });
}
