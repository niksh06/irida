import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { theme } from "../theme.js";

export function Composer(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled: boolean;
  scrollMode?: boolean;
  placeholder?: string;
}) {
  const { value, onChange, onSubmit, disabled, scrollMode, placeholder } = props;

  return (
    <Box
      borderStyle="single"
      borderColor={scrollMode ? theme.primary : theme.border}
      borderTop={false}
      paddingX={1}
      width="100%"
    >
      <Box width={4}>
        <Text bold color={scrollMode ? theme.primary : theme.prompt}>
          {scrollMode ? "⇕" : "›"}
        </Text>
      </Box>
      <Box flexGrow={1}>
        {scrollMode ? (
          <Text color={theme.muted}>Scroll mode — ↑↓ lines · PgUp/Dn · Ctrl+E bottom · Enter/Ctrl+O compose</Text>
        ) : disabled ? (
          <Text dimColor>{placeholder ?? "waiting…"}</Text>
        ) : (
          <TextInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            placeholder={placeholder ?? "Message… (/help · Ctrl+O scroll)"}
          />
        )}
      </Box>
    </Box>
  );
}
