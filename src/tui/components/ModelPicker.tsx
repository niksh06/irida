import React from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";

export function ModelPicker(props: {
  models: string[];
  current: string;
  index: number;
  onMove: (delta: number) => void;
  onSelect: (model: string) => void;
  onCancel: () => void;
}) {
  const { models, current, index, onMove, onSelect, onCancel } = props;

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) onMove(-1);
    if (key.downArrow) onMove(1);
    if (key.return && models[index]) onSelect(models[index]!);
    if (/^[0-9]$/.test(input)) {
      const n = Number(input);
      if (n >= 1 && n <= models.length) onSelect(models[n - 1]!);
    }
  });

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor={theme.accent}>
      <Text bold color={theme.accent}>
        Model (↑↓ · Enter apply · Esc cancel)
      </Text>
      {models.map((m, i) => {
        const active = i === index;
        const isCurrent = m === current;
        return (
          <Text key={m} color={active ? theme.primary : theme.text} bold={active}>
            {active ? "› " : "  "}
            {m}
            {isCurrent ? <Text color={theme.system}> (active)</Text> : null}
          </Text>
        );
      })}
      <Text dimColor>Applies on next session restart</Text>
    </Box>
  );
}
