import React, { useEffect, useMemo, useState } from "react";
import { Text, useInput } from "ink";
import { theme } from "../theme.js";
import type { SessionRecord } from "../../store.js";
import {
  filterSessions,
  mergeSessionFilterInput,
  sessionDisplayTitle,
  sessionPickerWindow,
} from "../sessionSearch.js";
import { OverlayPanel } from "./OverlayPanel.js";

const LIST_CAP = 8;

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
  const window = useMemo(
    () => sessionPickerWindow(filtered, index, LIST_CAP),
    [filtered, index]
  );

  useEffect(() => {
    setIndex((i) => {
      if (filtered.length === 0) return 0;
      return Math.min(i, filtered.length - 1);
    });
  }, [filtered.length, filter]);

  useInput(
    (input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.upArrow) {
        setIndex((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
        return;
      }
      if (key.downArrow) {
        setIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
        return;
      }
      if (key.return && filtered[index]) {
        onSelect(filtered[index]!);
        return;
      }
      if (/^[0-9]$/.test(input)) {
        const n = Number(input);
        if (n >= 1 && n <= filtered.length) onSelect(filtered[n - 1]!);
        return;
      }
      if (key.backspace || key.delete) {
        setFilter((f) => mergeSessionFilterInput(f, "", { backspace: true }));
        return;
      }
      if (!key.ctrl && !key.meta && input) {
        setFilter((f) => mergeSessionFilterInput(f, input, {}));
      }
    },
    { isActive: true }
  );

  return (
    <OverlayPanel title={`Sessions (${sessions.length}) — ↑↓ · Enter · filter · Esc`} footer="/resume id · Esc to close">
      <Text color={filter ? theme.primary : theme.muted}>
        filter: {filter || "…"}
        <Text dimColor> · {filtered.length} shown</Text>
      </Text>
      {error ? <Text color={theme.error}>{error}</Text> : null}
      {filtered.length === 0 ? (
        <Text color={theme.muted}>{sessions.length === 0 ? "No sessions yet." : "No matches."}</Text>
      ) : (
        <>
          {window.hiddenAbove > 0 ? (
            <Text color={theme.muted}>↑ {window.hiddenAbove} more</Text>
          ) : null}
          {window.visible.map((s, i) => {
            const rowIndex = window.start + i;
            const active = rowIndex === index;
            const title = sessionDisplayTitle(s, 36);
            return (
              <Text key={s.id} color={active ? theme.primary : theme.text} bold={active}>
                {active ? "› " : "  "}
                {rowIndex + 1}. {title}
                <Text dimColor> [{s.last_status || "?"}]</Text>
              </Text>
            );
          })}
          {window.hiddenBelow > 0 ? (
            <Text dimColor>…and {window.hiddenBelow} more</Text>
          ) : null}
        </>
      )}
    </OverlayPanel>
  );
}
