import React from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";
import type { ActivityEntry } from "../types.js";

export function ToolsPanel(props: { entries: ActivityEntry[]; onClose: () => void }) {
  useInput((_input, key) => {
    if (key.escape || key.return) props.onClose();
  });

  const recent = props.entries.slice(-20).reverse();

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor={theme.border}>
      <Text bold color={theme.primary}>
        Tool activity ({props.entries.length})
      </Text>
      {recent.length === 0 ? (
        <Text color={theme.muted}>No tool events yet this session.</Text>
      ) : (
        recent.map((e) => (
          <Text key={e.id} wrap="wrap" color={theme.muted}>
            <Text color={theme.accent}>{formatTs(e.at)}</Text> {e.label}
          </Text>
        ))
      )}
      <Text dimColor>Esc or Enter to close</Text>
    </Box>
  );
}

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "??:??:??";
  }
}
