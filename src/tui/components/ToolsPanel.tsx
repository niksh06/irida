import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";
import type { ActivityEntry } from "../types.js";
import { formatGroupSummary, groupActivityEntries } from "../activityGroups.js";

export function ToolsPanel(props: { entries: ActivityEntry[]; onClose: () => void }) {
  const groups = groupActivityEntries(props.entries).slice(-15).reverse();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focusIdx, setFocusIdx] = useState(0);

  useInput((input, key) => {
    if (key.escape || (key.return && groups.length === 0)) {
      props.onClose();
      return;
    }
    if (key.upArrow) setFocusIdx((i) => Math.max(0, i - 1));
    else if (key.downArrow) setFocusIdx((i) => Math.min(groups.length - 1, i + 1));
    else if (key.return && groups.length > 0) {
      const g = groups[focusIdx];
      if (!g) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(g.id)) next.delete(g.id);
        else next.add(g.id);
        return next;
      });
    } else if (input === "e") {
      setExpanded((prev) => {
        if (prev.size > 0) return new Set();
        return new Set(groups.map((g) => g.id));
      });
    }
  });

  const toolCount = props.entries.filter((e) => e.kind === "tool" || e.kind === "mcp").length;

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor={theme.border}>
      <Text bold color={theme.primary}>
        Tool activity ({toolCount} calls · {groups.length} groups)
      </Text>
      {groups.length === 0 ? (
        <Text color={theme.muted}>No tool events yet this session.</Text>
      ) : (
        groups.map((g, idx) => {
          const isOpen = expanded.has(g.id) || g.count === 1;
          const focused = idx === focusIdx;
          return (
            <Box flexDirection="column" key={g.id} marginBottom={1}>
              <Text wrap="wrap">
                <Text color={focused ? theme.primary : theme.muted}>{focused ? "▸ " : "  "}</Text>
                <Text color={kindColor(g.kind)}>[{g.kind}] </Text>
                <Text bold color={theme.accent}>
                  {formatGroupSummary(g)}
                </Text>
                {g.count > 1 && !isOpen ? (
                  <Text dimColor> · Enter expand</Text>
                ) : null}
              </Text>
              {isOpen
                ? g.entries.map((e) => (
                    <Box flexDirection="column" key={e.id} marginLeft={2}>
                      <Text wrap="wrap" dimColor>
                        {formatTs(e.at)} {e.status ?? ""}
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
                      {e.stdoutPreview && !e.detail?.includes("stdout:") ? (
                        <Text wrap="wrap" dimColor>
                          stdout: {e.stdoutPreview}
                        </Text>
                      ) : null}
                    </Box>
                  ))
                : g.lastCommand ? (
                    <Box marginLeft={2}>
                      <Text wrap="wrap" color={theme.text}>
                        {g.lastCommand}
                      </Text>
                    </Box>
                  ) : null}
              {g.lastStdout && !isOpen ? (
                <Box marginLeft={2}>
                  <Text wrap="wrap" dimColor>
                    stdout: {g.lastStdout}
                  </Text>
                </Box>
              ) : null}
            </Box>
          );
        })
      )}
      <Text dimColor>↑↓ select · Enter expand · e all · Esc close</Text>
    </Box>
  );
}

function kindColor(kind: ActivityEntry["kind"]): string {
  if (kind === "mcp") return theme.accent;
  if (kind === "tool") return theme.primary;
  return theme.muted;
}

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "??:??:??";
  }
}
