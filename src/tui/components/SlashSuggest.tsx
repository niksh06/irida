import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import { SLASH_COMMANDS } from "../slashCatalog.js";

export function SlashSuggest(props: { input: string; suggestions: string[] }) {
  const { input, suggestions } = props;
  if (!input.startsWith("/") || suggestions.length === 0) return null;

  const partial = input.slice(1).split(/\s+/)[0]?.toLowerCase() ?? "";
  const rows = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(partial)).slice(0, 6);

  return (
    <Box flexDirection="column" paddingX={1} marginTop={0}>
      <Text dimColor>Tab complete · {suggestions.length} match{suggestions.length === 1 ? "" : "es"}</Text>
      {rows.map((c) => (
        <Text key={c.cmd} color={theme.muted}>
          <Text color={theme.primary}>/{c.cmd}</Text>
          {c.args ? ` ${c.args}` : ""} — {c.desc}
        </Text>
      ))}
    </Box>
  );
}
