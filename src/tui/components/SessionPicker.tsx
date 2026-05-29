import React from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";
import type { SessionRecord } from "../../store.js";

export function SessionPicker(props: {
  sessions: SessionRecord[];
  index: number;
  error?: string | null;
  onMove: (delta: number) => void;
  onSelect: (session: SessionRecord) => void;
  onCancel: () => void;
}) {
  const { sessions, index, error, onMove, onSelect, onCancel } = props;

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) onMove(-1);
    if (key.downArrow) onMove(1);
    if (key.return && sessions[index]) onSelect(sessions[index]!);
    if (/^[0-9]$/.test(input)) {
      const n = Number(input);
      if (n >= 1 && n <= sessions.length) onSelect(sessions[n - 1]!);
    }
  });

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text bold color={theme.accent}>
        Sessions (↑↓ move · Enter pick · Esc cancel)
      </Text>
      {error ? <Text color={theme.error}>{error}</Text> : null}
      {sessions.length === 0 ? (
        <Text color={theme.muted}>No sessions yet.</Text>
      ) : (
        sessions.map((s, i) => {
          const active = i === index;
          const title = (s.title || "(untitled)").slice(0, 40);
          return (
            <Text key={s.id} color={active ? theme.primary : theme.text} bold={active}>
              {active ? "› " : "  "}
              {i + 1}. {s.id.slice(0, 14)}… [{s.last_status || "?"}] {title}
            </Text>
          );
        })
      )}
    </Box>
  );
}
