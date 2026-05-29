import React from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";
import type { ConfirmState } from "../types.js";

export function ConfirmDialog(props: { state: ConfirmState; onDone: () => void }) {
  const { state, onDone } = props;

  useInput((input, key) => {
    const ch = input.toLowerCase();
    if (ch === "y") {
      state.resolve(true);
      onDone();
      return;
    }
    if (ch === "n" || key.escape) {
      state.resolve(false);
      onDone();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.warn}
      paddingX={1}
      paddingY={0}
      marginTop={1}
    >
      <Text bold color={theme.warn}>
        ⚠ Safety check
      </Text>
      <Text wrap="wrap">{state.reason}</Text>
      <Text dimColor>Proceed? [y/N] · Esc cancels</Text>
    </Box>
  );
}
