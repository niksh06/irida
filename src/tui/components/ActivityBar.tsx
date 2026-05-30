import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { ActivityEntry } from "../types.js";
import { summarizeCommandForBar } from "../toolDisplay.js";
import { activityBarSummary, activityCounterLabel } from "../activityGroups.js";

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
  const counter = activityCounterLabel(props.recent);

  let headline: string;
  if (props.bannerActive && active) {
    headline = `${active.toolName ?? active.label} running…`;
  } else if (active?.command) {
    headline = summarizeCommandForBar(active.command);
  } else if (active) {
    headline = active.toolName ?? active.label;
  } else {
    const grouped = activityBarSummary(props.recent, props.busy);
    headline = grouped || props.label || last?.label || "thinking…";
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
