import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { SessionMeta, TurnStats } from "../types.js";
import { formatDuration } from "../../toolFormat.js";
import { estimateCostUsd, formatUsd } from "../../pricing.js";

export function StatusBar(props: {
  meta: SessionMeta | null;
  busy: boolean;
  error?: string | null;
  scrollHint?: string | null;
  lastTurn?: TurnStats | null;
  turnElapsedMs?: number;
  mcpCount?: number;
  sessionToolCalls?: number;
  /** Account/subscription engine — the $ is metered-equivalent, not billed. */
  subscription?: boolean;
}) {
  const { meta, busy, error, scrollHint, lastTurn, turnElapsedMs, mcpCount, sessionToolCalls, subscription } = props;
  const shortCwd = meta?.cwd ? shorten(meta.cwd, 24) : "—";
  const shortSid = meta?.sessionId ? meta.sessionId.slice(0, 10) : "—";

  const runLine = formatRunLine(busy, turnElapsedMs, lastTurn, sessionToolCalls, mcpCount, meta?.model, subscription);

  return (
    <Box
      borderStyle="single"
      borderColor={theme.border}
      paddingX={1}
      justifyContent="space-between"
      width="100%"
    >
      <Text backgroundColor={theme.statusBg} color={theme.statusFg}>
        {theme.icon} {theme.brand}
        {"  ·  "}
        <Text color={theme.primary}>{meta?.model ?? "—"}</Text>
        {"  ·  "}
        <Text dimColor>{shortCwd}</Text>
      </Text>
      <Text backgroundColor={theme.statusBg}>
        {error ? (
          <Text color={theme.error}>error</Text>
        ) : busy ? (
          <Text color={theme.statusBusy}>● busy</Text>
        ) : (
          <Text color={theme.statusGood}>● ready</Text>
        )}
        {runLine ? (
          <>
            {"  ·  "}
            <Text dimColor>{runLine}</Text>
          </>
        ) : null}
        {"  sid "}
        <Text dimColor>{shortSid}</Text>
        {scrollHint ? (
          <>
            {"  ·  "}
            <Text dimColor>{scrollHint}</Text>
          </>
        ) : null}
      </Text>
    </Box>
  );
}

function formatRunLine(
  busy: boolean,
  turnElapsedMs: number | undefined,
  lastTurn: TurnStats | null | undefined,
  sessionToolCalls: number | undefined,
  mcpCount: number | undefined,
  model: string | undefined,
  subscription: boolean | undefined
): string | null {
  const parts: string[] = [];

  if (busy && turnElapsedMs != null) {
    parts.push(formatDuration(turnElapsedMs));
  } else if (lastTurn) {
    parts.push(formatDuration(lastTurn.durationMs));
    if (lastTurn.toolCalls > 0) parts.push(`tools ${lastTurn.toolCalls}`);
    const tok = formatTokens(lastTurn);
    if (tok) parts.push(tok);
    const cost = formatTurnCost(lastTurn, model, subscription); // ~$ last turn (est; cache not counted)
    if (cost) parts.push(cost);
  } else if (sessionToolCalls != null && sessionToolCalls > 0) {
    parts.push(`tools ${sessionToolCalls}`);
  }

  if (mcpCount != null && mcpCount > 0) parts.push(`mcp ${mcpCount}`);

  return parts.length ? parts.join(" · ") : null;
}

/**
 * Last-turn cost estimate, or null when the model isn't in the price table.
 * Input+output only (TurnStats has no cache fields) → an undercount vs `/usage`;
 * the `~` flags that. On the account engine the $ is metered-equivalent, not
 * billed, so it's tagged `sub`.
 */
function formatTurnCost(t: TurnStats, model: string | undefined, subscription: boolean | undefined): string | null {
  if (!model) return null;
  const usd = estimateCostUsd({ inputTokens: t.inputTokens, outputTokens: t.outputTokens }, model);
  if (usd == null || usd <= 0) return null;
  return `~${formatUsd(usd)}${subscription ? " sub" : ""}`;
}

function formatTokens(t: TurnStats): string | null {
  const inT = t.inputTokens;
  const outT = t.outputTokens;
  if (inT == null && outT == null) return null;
  const total = (inT ?? 0) + (outT ?? 0);
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k tok`;
  if (total > 0) return `${total} tok`;
  return null;
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.max(8, Math.floor(max * 0.45));
  const tail = max - head - 1;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
