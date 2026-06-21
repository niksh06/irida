import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import { SLASH_COMMANDS } from "../slashCatalog.js";

export function SlashSuggest(props: { input: string; suggestions: string[] }) {
  const { input, suggestions } = props;
  if (!input.startsWith("/") || suggestions.length === 0) return null;

  const partial = input.slice(1).split(/\s+/)[0]?.toLowerCase() ?? "";
  const rows = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(partial)).slice(0, 6);
  if (rows.length === 0) return null;

  // Align the descriptions into a column; the command label is "/cmd args".
  const labelLen = (c: (typeof rows)[number]) => 1 + c.cmd.length + (c.args ? c.args.length + 1 : 0);
  const colWidth = Math.min(22, Math.max(...rows.map(labelLen)) + 1);

  return (
    <Box flexDirection="column" paddingX={1} marginTop={0}>
      <Text dimColor>
        Tab complete · {suggestions.length} match{suggestions.length === 1 ? "" : "es"}
      </Text>
      {rows.map((c, i) => {
        const top = i === 0; // the primary suggestion Tab moves toward
        const rest = c.cmd.slice(partial.length);
        return (
          <Box key={c.cmd}>
            <Text color={top ? theme.accent : theme.muted}>{top ? "▸ " : "  "}</Text>
            <Box width={colWidth}>
              <Text>
                <Text color={theme.accent} bold>
                  /{partial}
                </Text>
                <Text color={theme.primary}>{rest}</Text>
                {c.args ? <Text dimColor> {c.args}</Text> : null}
              </Text>
            </Box>
            <Text dimColor={!top} color={top ? theme.muted : undefined}>
              {c.desc}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
