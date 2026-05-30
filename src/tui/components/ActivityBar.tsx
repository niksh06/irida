import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { ActivityEntry } from "../types.js";
import { summarizeCommandForBar, toolEventCounterLabel } from "../toolDisplay.js";

export function ActivityBar(props: {
  label: string | null;
  busy: boolean;
  recent: ActivityEntry[];
  /** When ToolCallBanner is showing the command, keep this strip minimal. */
  bannerActive?: boolean;
}) {
  const last = props.recent[props.recent.length - 1];
  const show = props.busy || props.label || last;
  if (!show) return null;

  const active = last?.phase === "call" && last.status === "running" ? last : null;
  const counter = toolEventCounterLabel(props.recent.length);

  let headline: string;
  if (props.bannerActive && active) {
    headline = `${active.toolName ?? active.label} running…`;
  } else if (active?.command) {
    headline = summarizeCommandForBar(active.command);
  } else if (active) {
    headline = active.toolName ?? active.label;
  } else {
    headline = props.label ?? last?.label ?? "thinking…";
  }

  return (
    <Box flexDirection="column" paddingX={1} marginTop={0}>
      <Text color={theme.muted}>
        {props.busy ? "◌ " : "⚙ "}
        {active ? (
          <Text color={theme.warn}>
            {active.toolName ?? active.label}
            <Text color={theme.muted}> · </Text>
          </Text>
        ) : null}
        <Text color={theme.accent}>{headline}</Text>
      </Text>
      {counter ? (
        <Text dimColor>  {counter}</Text>
      ) : null}
    </Box>
  );
}
