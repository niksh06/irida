import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import { brailleSpinner, driftWave } from "../spinner.js";

// Re-exported under the original names so existing callers/tests stay stable.
export { brailleSpinner as thinkingSpinner, driftWave as thinkingWave };

export function ThinkingBar(props: {
  text: string;
  expanded: boolean;
  tick?: number;
  elapsedMs?: number;
}) {
  const { text, expanded, tick = 0, elapsedMs } = props;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const preview = trimmed.replace(/\s+/g, " ");
  const shown =
    expanded || preview.length <= 100 ? trimmed : `${preview.slice(0, 100).trimEnd()}…`;
  const secs = elapsedMs && elapsedMs >= 1000 ? ` ${Math.floor(elapsedMs / 1000)}s` : "";

  return (
    <Box flexDirection="column" paddingX={1} marginTop={0}>
      <Text>
        <Text color={theme.accent}>{brailleSpinner(tick)}</Text>
        <Text color={theme.statusBusy}> thinking</Text>
        {secs ? <Text dimColor>{secs}</Text> : null}
        <Text color={theme.accent}>
          {"   "}
          {driftWave(tick)}
        </Text>
        {!expanded && preview.length > 100 ? <Text dimColor>{"   "}Ctrl+T expand</Text> : null}
      </Text>
      <Text wrap="wrap" dimColor>
        {shown}
      </Text>
    </Box>
  );
}
