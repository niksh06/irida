import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { SessionRecord } from "../../store.js";
import { sessionDisplayTitle } from "../sessionSearch.js";
import { SESSION_TAB_BAR_MAX, visibleTabSessions } from "../sessionTabs.js";

export function SessionTabBar(props: {
  sessions: SessionRecord[];
  activeId: string | null;
  width: number;
}) {
  const { sessions, activeId, width } = props;
  if (sessions.length === 0) return null;

  const tabs = visibleTabSessions(sessions);
  const more = sessions.length - tabs.length;

  return (
    <Box paddingX={1} marginBottom={0}>
      <Text dimColor>tabs </Text>
      {tabs.map((s, i) => {
        const active = s.id === activeId;
        const label = sessionDisplayTitle(s, 12);
        const num = i + 1;
        return (
          <Text key={s.id} color={active ? theme.primary : theme.muted} bold={active}>
            {active ? ` ${num}●` : ` ${num}○`}
            {label}
          </Text>
        );
      })}
      {more > 0 ? <Text dimColor>{` +${more}`}</Text> : null}
      <Text dimColor>
        {width > 64 ? `  1-${Math.min(SESSION_TAB_BAR_MAX, tabs.length)} · Tab · ←→` : ""}
      </Text>
    </Box>
  );
}
