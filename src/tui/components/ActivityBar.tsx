import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { ActivityEntry } from "../types.js";

export function ActivityBar(props: {
  label: string | null;
  busy: boolean;
  recent: ActivityEntry[];
}) {
  const last = props.recent[props.recent.length - 1];
  const show = props.busy || props.label || last;
  if (!show) return null;

  const active = last?.phase === "call" && last.status === "running" ? last : null;
  const headline = active?.command ?? props.label ?? last?.command ?? last?.label ?? "thinking…";

  return (
    <Box flexDirection="column" paddingX={1} marginTop={0}>
      <Text color={theme.muted}>
        {props.busy ? "◌ " : "· "}
        {active ? (
          <Text color={theme.warn}>
            {active.toolName ?? active.label}
            <Text color={theme.muted}> → </Text>
          </Text>
        ) : null}
        <Text color={theme.accent} wrap="wrap">
          {headline}
        </Text>
        {props.recent.length > 1 ? (
          <Text dimColor>{`  (+${props.recent.length - 1} · /tools)`}</Text>
        ) : null}
      </Text>
    </Box>
  );
}
