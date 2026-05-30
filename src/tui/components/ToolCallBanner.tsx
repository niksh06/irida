import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { ActivityEntry } from "../types.js";
import { truncateCommandForBanner } from "../toolDisplay.js";

/** Live banner for an in-flight tool call — shows command (line-capped). */
export function ToolCallBanner(props: { entry: ActivityEntry | null }) {
  const { entry } = props;
  if (!entry || entry.phase !== "call" || entry.status !== "running") return null;
  if (!entry.command) return null;

  const { text, truncated, totalLines } = truncateCommandForBanner(entry.command);

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
        <Text color={theme.muted}>
          {" "}
          running{totalLines > 1 ? ` · ${totalLines} lines` : ""}
          {truncated ? " · truncated" : ""}
        </Text>
      </Text>
      <Text wrap="wrap" color={theme.text}>
        {text}
      </Text>
    </Box>
  );
}
