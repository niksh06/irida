import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { ActivityEntry } from "../types.js";
import { summarizeCommandForBar } from "../toolDisplay.js";
import { activityBarSummary, activityCounterLabel, shouldShowActivityBar } from "../activityGroups.js";
import { brailleSpinner } from "../spinner.js";
import { classifyPetActivity, petActivityGlyph } from "../../petTerminal.js";

export function ActivityBar(props: {
  label: string | null;
  busy: boolean;
  recent: ActivityEntry[];
  /** Animation tick (shared petClock) — spins the live indicator. */
  tick?: number;
  /** When ToolCallBanner is showing the command, keep this strip minimal. */
  bannerActive?: boolean;
}) {
  const last = props.recent[props.recent.length - 1];
  const show = shouldShowActivityBar(props.recent, props.busy, props.label);
  if (!show) return null;

  const active = last?.phase === "call" && last.status === "running" ? last : null;
  const counter = activityCounterLabel(props.recent);
  // Same braille orbit as the thinking line + Wisp's clock, so the surfaces pulse together.
  const lead = props.busy ? brailleSpinner(props.tick ?? 0) : "⚙";
  // Tag the active tool with Wisp's vocabulary (⌕ search, ✎ edit, ▤ read, ›_ shell, ⇄ mcp).
  const glyph = active ? petActivityGlyph(classifyPetActivity(active.toolName, active.kind)) : null;

  let headline: string;
  if (props.bannerActive && active) {
    headline = `${active.toolName ?? active.label} running…`;
  } else if (active?.command) {
    headline = summarizeCommandForBar(active.command);
  } else if (active) {
    headline = active.toolName ?? active.label;
  } else {
    const grouped = activityBarSummary(props.recent, props.busy);
    headline = grouped || props.label || (props.busy ? (last?.label ?? "thinking…") : "");
  }

  return (
    <Box flexDirection="column" paddingX={1} marginTop={0}>
      <Text color={theme.muted}>
        <Text color={props.busy ? theme.accent : theme.muted}>{lead} </Text>
        {active ? (
          <Text color={theme.warn}>
            {glyph ? `${glyph} ` : ""}
            {active.toolName ?? active.label}
            <Text color={theme.muted}> · </Text>
          </Text>
        ) : null}
        <Text color={theme.accent}>{headline}</Text>
      </Text>
      {counter ? <Text dimColor>  {counter}</Text> : null}
    </Box>
  );
}
