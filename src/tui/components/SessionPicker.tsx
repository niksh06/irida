import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";
import type { SessionRecord } from "../../store.js";
import { filterSessions, sessionDisplayTitle } from "../sessionSearch.js";

export function SessionPicker(props: {
  sessions: SessionRecord[];
  error?: string | null;
  onSelect: (session: SessionRecord) => void;
  onCancel: () => void;
}) {
  const { sessions, error, onSelect, onCancel } = props;
  const [filter, setFilter] = useState("");
  const [index, setIndex] = useState(0);

  const filtered = useMemo(() => filterSessions(sessions, filter), [sessions, filter]);

  useEffect(() => {
    setIndex((i) => {
      if (filtered.length === 0) return 0;
      return Math.min(i, filtered.length - 1);
    });
  }, [filtered.length, filter]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setIndex((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
    }
    if (key.downArrow) {
      setIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    }
    if (key.return && filtered[index]) onSelect(filtered[index]!);
    if (/^[0-9]$/.test(input)) {
      const n = Number(input);
      if (n >= 1 && n <= filtered.length) onSelect(filtered[n - 1]!);
    }
    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      return;
    }
    if (!key.ctrl && !key.meta && input && input.length === 1 && input >= " ") {
      setFilter((f) => f + input);
    }
  });

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text bold color={theme.accent}>
        Sessions (↑↓ · Enter · type to filter · Esc)
      </Text>
      {filter ? (
        <Text color={theme.primary}>
          filter: {filter}
          <Text dimColor> · {filtered.length}/{sessions.length}</Text>
        </Text>
      ) : null}
      {error ? <Text color={theme.error}>{error}</Text> : null}
      {filtered.length === 0 ? (
        <Text color={theme.muted}>{sessions.length === 0 ? "No sessions yet." : "No matches."}</Text>
      ) : (
        filtered.map((s, i) => {
          const active = i === index;
          const title = sessionDisplayTitle(s, 36);
          return (
            <Text key={s.id} color={active ? theme.primary : theme.text} bold={active}>
              {active ? "› " : "  "}
              {i + 1}. {title}
              <Text dimColor> [{s.last_status || "?"}] {s.id.slice(0, 10)}…</Text>
            </Text>
          );
        })
      )}
    </Box>
  );
}
