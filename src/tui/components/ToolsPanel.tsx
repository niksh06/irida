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
          <Box flexDirection="column" key={e.id} marginBottom={1}>
            <Text wrap="wrap">
              <Text color={theme.muted}>{formatTs(e.at)} </Text>
              <Text color={kindColor(e.kind)}>[{e.kind}] </Text>
              <Text color={theme.accent} bold>
                {e.toolName ?? e.label}
              </Text>
              {e.status ? (
                <Text color={statusColor(e.status)}> {e.status}</Text>
              ) : null}
            </Text>
            {e.command ? (
              <Text wrap="wrap" color={theme.text}>
                {e.command}
              </Text>
            ) : null}
            {e.detail ? (
              <Text wrap="wrap" dimColor>
                {e.detail}
              </Text>
            ) : null}
          </Box>
        ))
      )}
      <Text dimColor>Esc or Enter to close</Text>
    </Box>
  );
}

function kindColor(kind: ActivityEntry["kind"]): string {
  if (kind === "mcp") return theme.accent;
  if (kind === "tool") return theme.primary;
  return theme.muted;
}

function statusColor(status: NonNullable<ActivityEntry["status"]>): string {
  if (status === "error") return theme.error;
  if (status === "running") return theme.warn;
  return theme.system;
}

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "??:??:??";
  }
}
