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

  return (
    <Box flexDirection="column" paddingX={1} marginTop={0}>
      <Text color={theme.muted}>
        {props.busy ? "◌ " : "· "}
        <Text color={theme.accent}>{props.label ?? last?.label ?? "thinking…"}</Text>
        {props.recent.length > 1 ? (
          <Text dimColor>{`  (+${props.recent.length - 1} events · /tools)`}</Text>
        ) : null}
      </Text>
    </Box>
  );
}
