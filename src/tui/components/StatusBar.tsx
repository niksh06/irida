import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { SessionMeta } from "../types.js";

export function StatusBar(props: {
  meta: SessionMeta | null;
  busy: boolean;
  error?: string | null;
  scrollHint?: string | null;
}) {
  const { meta, busy, error, scrollHint } = props;
  const shortCwd = meta?.cwd ? shorten(meta.cwd, 28) : "—";
  const shortSid = meta?.sessionId ? meta.sessionId.slice(0, 12) : "—";
  const agent = meta?.agentId ? meta.agentId.slice(0, 10) : "—";

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
        {"  sid "}
        <Text dimColor>{shortSid}</Text>
        {"  agent "}
        <Text dimColor>{agent}</Text>
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

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.max(8, Math.floor(max * 0.45));
  const tail = max - head - 1;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
