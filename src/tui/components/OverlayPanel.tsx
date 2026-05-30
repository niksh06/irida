import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

/** Shared bordered shell for slash-command overlays (/sessions, /skills, …). */
export function OverlayPanel(props: {
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: string;
}) {
  return (
    <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor={theme.border}>
      {typeof props.title === "string" ? (
        <Text bold color={theme.primary}>
          {props.title}
        </Text>
      ) : (
        props.title
      )}
      {props.children}
      {props.footer ? <Text dimColor>{props.footer}</Text> : null}
    </Box>
  );
}
