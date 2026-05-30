import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { SessionMeta, TurnStats } from "../types.js";
import { formatDuration } from "../../toolFormat.js";

export function StatusBar(props: {
  meta: SessionMeta | null;
  busy: boolean;
  error?: string | null;
  scrollHint?: string | null;
  lastTurn?: TurnStats | null;
  turnElapsedMs?: number;
  mcpCount?: number;
  sessionToolCalls?: number;
}) {
  const { meta, busy, error, scrollHint, lastTurn, turnElapsedMs, mcpCount, sessionToolCalls } = props;
  const shortCwd = meta?.cwd ? shorten(meta.cwd, 24) : "—";
  const shortSid = meta?.sessionId ? meta.sessionId.slice(0, 10) : "—";

  const runLine = formatRunLine(busy, turnElapsedMs, lastTurn, sessionToolCalls, mcpCount);

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
  mcpCount: number | undefined
): string | null {
  const parts: string[] = [];

  if (busy && turnElapsedMs != null) {
    parts.push(formatDuration(turnElapsedMs));
  } else if (lastTurn) {
    parts.push(formatDuration(lastTurn.durationMs));
    if (lastTurn.toolCalls > 0) parts.push(`tools ${lastTurn.toolCalls}`);
    const tok = formatTokens(lastTurn);
    if (tok) parts.push(tok);
  } else if (sessionToolCalls != null && sessionToolCalls > 0) {
    parts.push(`tools ${sessionToolCalls}`);
  }

  if (mcpCount != null && mcpCount > 0) parts.push(`mcp ${mcpCount}`);

  return parts.length ? parts.join(" · ") : null;
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
