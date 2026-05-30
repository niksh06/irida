import React from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";
import type { McpEntryView } from "../mcpView.js";

export function McpPanel(props: {
  entries: McpEntryView[];
  errors: string[];
  onClose: () => void;
}) {
  useInput((_input, key) => {
    if (key.escape || key.return) props.onClose();
  });

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor={theme.border}>
      <Text bold color={theme.primary}>
        MCP servers ({props.entries.length})
      </Text>
      {props.errors.map((e) => (
        <Text key={e} color={theme.error}>
          {e}
        </Text>
      ))}
      {props.entries.length === 0 ? (
        <Text color={theme.muted}>None in agent.config.json</Text>
      ) : (
        props.entries.map((e) => (
          <Text key={e.name} wrap="wrap">
            <Text color={theme.accent}>{e.name.padEnd(12)}</Text>
            <Text dimColor>
              [{e.kind}] {e.target}
            </Text>
          </Text>
        ))
      )}
      <Text dimColor>Esc or Enter to close</Text>
    </Box>
  );
}
