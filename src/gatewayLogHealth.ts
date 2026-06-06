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
