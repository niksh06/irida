import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

export function ThinkingBar(props: {
  text: string;
  expanded: boolean;
}) {
  const { text, expanded } = props;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const preview = trimmed.replace(/\s+/g, " ");
  const shown =
    expanded || preview.length <= 100 ? trimmed : `${preview.slice(0, 100).trimEnd()}…`;

  return (
    <Box flexDirection="column" paddingX={1} marginTop={0}>
      <Text color={theme.muted}>
        💭 thinking
        {!expanded && preview.length > 100 ? (
          <Text dimColor> · Ctrl+T expand</Text>
        ) : null}
      </Text>
      <Text wrap="wrap" dimColor>
        {shown}
      </Text>
    </Box>
  );
}
