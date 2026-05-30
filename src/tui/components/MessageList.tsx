import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { TranscriptRow } from "../transcript.js";

const roleLabel: Record<TranscriptRow["role"], { glyph: string; color: string }> = {
  user: { glyph: "you ›", color: theme.user },
  assistant: { glyph: "◆", color: theme.assistant },
  system: { glyph: "·", color: theme.system },
  error: { glyph: "!", color: theme.error },
};

export function MessageList(props: {
  rows: TranscriptRow[];
  width: number;
  hiddenAbove?: number;
  hiddenBelow?: number;
  atBottom?: boolean;
  scrollMode?: boolean;
  nativeScroll?: boolean;
  totalLines?: number;
}) {
  const {
    rows,
    hiddenAbove = 0,
    hiddenBelow = 0,
    atBottom = true,
    scrollMode = false,
    nativeScroll = false,
    totalLines = 0,
  } = props;

  if (rows.length === 0 && hiddenAbove === 0) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text color={theme.muted}>
          Type a message. /help · {nativeScroll ? "trackpad scroll" : "Ctrl+O scroll"} · Ctrl+C quit
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {scrollMode ? (
        <Text color={theme.primary} bold>
          SCROLL ↑↓ PgUp/Dn · Ctrl+G top · Ctrl+E bottom · Enter compose
        </Text>
      ) : null}
      {hiddenAbove > 0 ? (
        <Text color={theme.muted}>
          ↑ {hiddenAbove} earlier line{hiddenAbove === 1 ? "" : "s"}
          {totalLines > 0 ? ` · L${hiddenAbove + rows.length}/${totalLines}` : ""}
        </Text>
      ) : null}
      {rows.map((row) => {
        const style = roleLabel[row.role];
        return (
          <Box flexDirection="column" key={row.key} marginTop={row.showSep ? 1 : 0}>
            {row.showSep ? (
              <Text color={theme.border}>{"─".repeat(Math.min(48, props.width - 4))}</Text>
            ) : null}
            <Box>
              <Box width={6}>
                {row.showRole ? (
                  <Text bold={row.role === "user"} color={style.color}>
                    {style.glyph}
                  </Text>
                ) : (
                  <Text> </Text>
                )}
              </Box>
              <Box flexGrow={1}>
                <Text color={row.role === "error" ? theme.error : style.color}>
                  {row.text}
                  {row.streaming ? <Text color={theme.muted}>▍</Text> : null}
                </Text>
              </Box>
            </Box>
          </Box>
        );
      })}
      {hiddenBelow > 0 ? (
        <Text color={theme.muted}>↓ {hiddenBelow} newer line{hiddenBelow === 1 ? "" : "s"} · Ctrl+E follow</Text>
      ) : null}
      {!atBottom && hiddenBelow === 0 ? (
        <Text color={theme.muted}>↓ newer below · Ctrl+E follow</Text>
      ) : null}
    </Box>
  );
}
