import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

export function ActivityBar(props: { label: string | null; busy: boolean }) {
  if (!props.label && !props.busy) return null;
  return (
    <Box paddingX={1} marginTop={0}>
      <Text color={theme.muted}>
        {props.busy ? "◌ " : "· "}
        <Text color={theme.accent}>{props.label ?? "thinking…"}</Text>
      </Text>
    </Box>
  );
}
