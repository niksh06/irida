import React from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";
import { SLASH_HELP } from "../slash.js";

export function HelpPanel(props: { onClose: () => void }) {
  useInput((_input, key) => {
    if (key.escape || key.return) props.onClose();
  });

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor={theme.border}>
      <Text bold color={theme.primary}>
        csagent tui — commands
      </Text>
      <Text color={theme.muted}>{SLASH_HELP}</Text>
      <Text dimColor>Esc or Enter to close</Text>
    </Box>
  );
}
