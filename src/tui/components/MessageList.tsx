import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { ChatMessage } from "../types.js";

const roleLabel: Record<ChatMessage["role"], { glyph: string; color: string }> = {
  user: { glyph: "you ›", color: theme.user },
  assistant: { glyph: "◆", color: theme.assistant },
  system: { glyph: "·", color: theme.system },
  error: { glyph: "!", color: theme.error },
};

export function MessageList(props: {
  messages: ChatMessage[];
  width: number;
  hiddenAbove?: number;
  hiddenBelow?: number;
  atBottom?: boolean;
}) {
  const { messages, hiddenAbove = 0, hiddenBelow = 0, atBottom = true } = props;

  if (messages.length === 0 && hiddenAbove === 0) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text color={theme.muted}>
          Type a message. /help for commands · Ctrl+C to leave.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {hiddenAbove > 0 ? (
        <Text color={theme.muted}>↑ {hiddenAbove} earlier message{hiddenAbove === 1 ? "" : "s"}</Text>
      ) : null}
      {messages.map((m, i) => {
        const style = roleLabel[m.role];
        const showSep = m.role === "user" && i > 0 && messages[i - 1]?.role !== "system";
        return (
          <Box flexDirection="column" key={m.id} marginTop={showSep ? 1 : 0}>
            {showSep ? (
              <Text color={theme.border}>{"─".repeat(Math.min(48, props.width - 4))}</Text>
            ) : null}
            <Box>
              <Box width={6}>
                <Text bold={m.role === "user"} color={style.color}>
                  {style.glyph}
                </Text>
              </Box>
              <Box flexGrow={1}>
                <Text wrap="wrap" color={m.role === "error" ? theme.error : style.color}>
                  {m.text}
                  {m.streaming ? <Text color={theme.muted}>▍</Text> : null}
                </Text>
              </Box>
            </Box>
          </Box>
        );
      })}
      {!atBottom && hiddenBelow === 0 ? (
        <Text color={theme.muted}>↓ newer messages below (Ctrl+D)</Text>
      ) : null}
      {hiddenBelow > 0 ? (
        <Text color={theme.muted}>↓ {hiddenBelow} newer · Ctrl+End to follow</Text>
      ) : null}
    </Box>
  );
}
