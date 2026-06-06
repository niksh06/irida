import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";
import { listContextRefs, probeContextRef, type ContextRefProbe } from "../../contextRefs.js";
import {
  cursorLineCol,
  deleteBefore,
  eraseBeforeCursor,
  insertAt,
  lineColToCursor,
  moveCursor,
  visibleComposerLines,
} from "../multilineInput.js";

const MAX_VISIBLE_LINES = 6;

export function Composer(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled: boolean;
  scrollMode?: boolean;
  placeholder?: string;
  cwd?: string;
  /** When input empty: digit 1–5 selects session tab; ←→ cycles tabs. */
  onSessionTabSelect?: (index: number) => void;
  onSessionTabCycle?: (delta: number) => void;
}) {
  const { value, onChange, onSubmit, disabled, scrollMode, placeholder, cwd, onSessionTabSelect, onSessionTabCycle } =
    props;
  const [cursor, setCursor] = useState(() => props.value.length);

  useEffect(() => {
    setCursor((c) => Math.min(c, value.length));
  }, [value]);

  const apply = useCallback(
    (next: string, nextCursor: number) => {
      onChange(next);
      setCursor(nextCursor);
    },
    [onChange]
  );

  useInput(
    (input, key) => {
      if (key.ctrl && input === "j") {
        const { value: v, cursor: c } = insertAt(value, cursor, "\n");
        apply(v, c);
        return;
      }
      if (key.return && key.shift) {
        const { value: v, cursor: c } = insertAt(value, cursor, "\n");
        apply(v, c);
        return;
      }
      if (key.return) {
        const t = value.trim();
        if (t) onSubmit(value);
        return;
      }
      if (key.ctrl && input === "u") {
        const { line } = cursorLineCol(value, cursor);
        const lines = value.split("\n");
        lines[line] = "";
        const next = lines.join("\n");
        apply(next, lineColToCursor(next, line, 0));
        return;
      }
      // Ink maps Mac Backspace (\x7f) to key.delete — always erase before cursor (ink-text-input parity).
      if (key.backspace || key.delete) {
        const out = eraseBeforeCursor(value, cursor);
        apply(out.value, out.cursor);
        return;
      }
      if (key.leftArrow) {
        if (value.length === 0 && onSessionTabCycle) {
          onSessionTabCycle(-1);
          return;
        }
        setCursor(moveCursor(value, cursor, "left"));
        return;
      }
      if (key.rightArrow) {
        if (value.length === 0 && onSessionTabCycle) {
          onSessionTabCycle(1);
          return;
        }
        setCursor(moveCursor(value, cursor, "right"));
        return;
      }
      if (key.upArrow) {
        setCursor(moveCursor(value, cursor, "up"));
        return;
      }
      if (key.downArrow) {
        setCursor(moveCursor(value, cursor, "down"));
        return;
      }
      if (!key.ctrl && !key.meta && input) {
        if (value.length === 0 && onSessionTabSelect && input.length === 1) {
          const n = input.charCodeAt(0) - 49;
          if (n >= 0 && n < 5) {
            onSessionTabSelect(n);
            return;
          }
        }
        const { value: v, cursor: c } = insertAt(value, cursor, input);
        apply(v, c);
      }
    },
    { isActive: !disabled && !scrollMode }
  );

  const refs = cwd ? listContextRefs(value) : [];
  const view = visibleComposerLines(value, cursor, MAX_VISIBLE_LINES);

  return (
    <Box flexDirection="column" width="100%">
      <Box
        borderStyle="single"
        borderColor={scrollMode ? theme.primary : theme.border}
        borderTop={false}
        paddingX={1}
        width="100%"
        flexDirection="column"
      >
        <Box width="100%">
          <Box width={4}>
            <Text bold color={scrollMode ? theme.primary : theme.prompt}>
              {scrollMode ? "⇕" : "›"}
            </Text>
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {scrollMode ? (
              <Text color={theme.muted}>
                Scroll mode — ↑↓ lines · PgUp/Dn · Ctrl+E bottom · Enter/Ctrl+O compose
              </Text>
            ) : disabled ? (
              <Text dimColor>{placeholder ?? "waiting…"}</Text>
            ) : value.length === 0 ? (
              <Text dimColor>{placeholder ?? "Message… (Ctrl+J newline · @file:path · /help)"}</Text>
            ) : (
              <Box flexDirection="column">
                {view.hiddenAbove > 0 ? (
                  <Text dimColor>… {view.hiddenAbove} lines above</Text>
                ) : null}
                {view.lines.map((line, i) => (
                  <ComposerLine
                    key={`${view.startLine}-${i}`}
                    line={line}
                    active={i === view.cursorLine}
                    cursorCol={i === view.cursorLine ? view.cursorCol : -1}
                  />
                ))}
              </Box>
            )}
          </Box>
        </Box>
        {!disabled && !scrollMode && refs.length > 0 && cwd ? (
          <ContextRefStrip cwd={cwd} refs={refs} />
        ) : null}
      </Box>
    </Box>
  );
}

function ComposerLine(props: { line: string; active: boolean; cursorCol: number }) {
  const { line, active, cursorCol } = props;
  if (!active || cursorCol < 0) {
    return (
      <Text wrap="truncate">
        {line.length === 0 ? " " : line}
      </Text>
    );
  }
  const before = line.slice(0, cursorCol);
  const at = line[cursorCol] ?? " ";
  const after = line.slice(cursorCol + 1);
  return (
    <Text wrap="truncate">
      {before}
      <Text backgroundColor={theme.primary} color={theme.statusBg}>
        {at}
      </Text>
      {after}
    </Text>
  );
}

function ContextRefStrip(props: { cwd: string; refs: ReturnType<typeof listContextRefs> }) {
  return (
    <Box marginTop={0} paddingLeft={4}>
      <Text dimColor>
        context:{" "}
        {props.refs.map((r, i) => (
          <Text key={`${r.kind}-${r.raw}`}>
            {i > 0 ? " · " : ""}
            <Text color={probeColor(probeContextRef(props.cwd, r))}>
              @{r.kind}:{r.display}
            </Text>
          </Text>
        ))}
      </Text>
    </Box>
  );
}

function probeColor(p: ContextRefProbe): string {
  if (p === "ok") return theme.statusGood;
  if (p === "missing") return theme.error;
  return theme.warn;
}
