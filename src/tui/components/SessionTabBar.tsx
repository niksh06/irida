import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { SessionRecord } from "../../store.js";
import { sessionDisplayTitle } from "../sessionSearch.js";

export function SessionTabBar(props: {
  sessions: SessionRecord[];
  activeId: string | null;
  width: number;
}) {
  const { sessions, activeId, width } = props;
  if (sessions.length === 0) return null;

  const tabs = sessions.slice(0, 5);
  const more = sessions.length - tabs.length;

  return (
    <Box paddingX={1} marginBottom={0}>
      <Text dimColor>tabs </Text>
      {tabs.map((s) => {
        const active = s.id === activeId;
        const label = sessionDisplayTitle(s, 14);
        return (
          <Text key={s.id} color={active ? theme.primary : theme.muted} bold={active}>
            {active ? " ● " : " ○ "}
            {label}
          </Text>
        );
      })}
      {more > 0 ? <Text dimColor>{` +${more}`}</Text> : null}
      <Text dimColor>{width > 70 ? "  ⌃[ ⌃] switch" : ""}</Text>
    </Box>
  );
}
