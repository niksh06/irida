import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { theme } from "../theme.js";

export function Composer(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  const { value, onChange, onSubmit, disabled, placeholder } = props;

  return (
    <Box
      borderStyle="single"
      borderColor={theme.border}
      borderTop={false}
      paddingX={1}
      width="100%"
    >
      <Box width={4}>
        <Text bold color={theme.prompt}>
          ›
        </Text>
      </Box>
      <Box flexGrow={1}>
        {disabled ? (
          <Text dimColor>{placeholder ?? "waiting…"}</Text>
        ) : (
          <TextInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            placeholder={placeholder ?? "Message… (/exit to quit)"}
          />
        )}
      </Box>
    </Box>
  );
}
