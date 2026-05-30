import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { ActivityEntry } from "../types.js";

/** Live banner for an in-flight tool call — shows the full command. */
export function ToolCallBanner(props: { entry: ActivityEntry | null }) {
  const { entry } = props;
  if (!entry || entry.phase !== "call" || entry.status !== "running") return null;
  if (!entry.command) return null;

  return (
    <Box
      flexDirection="column"
      marginTop={0}
      marginX={1}
      paddingX={1}
      borderStyle="round"
      borderColor={theme.warn}
    >
      <Text bold color={theme.warn}>
        ⚙ {entry.toolName ?? entry.label}
        <Text color={theme.muted}> running…</Text>
      </Text>
      <Text wrap="wrap" color={theme.text}>
        {entry.command}
      </Text>
    </Box>
  );
}
