import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { TranscriptRow } from "../transcript.js";
import type { MdSegment } from "../markdown.js";
import { petTerminalFrame } from "../../petTerminal.js";
import { WispGlyphLine } from "./wispGlyph.js";

/** Render one markdown line's styled segments as colored/weighted Ink spans. */
function MarkdownLine(props: { segments: MdSegment[]; fallback: string; streaming?: boolean }) {
  return (
    <Text color={theme.assistant}>
      {props.segments.map((s, i) => {
        switch (s.style) {
          case "bold":
            return (
              <Text key={i} bold color={theme.assistant}>
                {s.text}
              </Text>
            );
          case "italic":
            return (
              <Text key={i} italic>
                {s.text}
              </Text>
            );
          case "code":
          case "codeblock":
            return (
              <Text key={i} color={theme.warn}>
                {s.text}
              </Text>
            );
          case "heading":
            return (
              <Text key={i} bold color={theme.accent}>
                {s.text}
              </Text>
            );
          case "bullet":
            return (
              <Text key={i} color={theme.accent}>
                {s.text}
              </Text>
            );
          case "quote":
            return (
              <Text key={i} color={theme.muted}>
                {s.text}
              </Text>
            );
          default:
            return <Text key={i}>{s.text}</Text>;
        }
      })}
      {props.streaming ? <Text color={theme.muted}>▍</Text> : null}
    </Text>
  );
}

const roleLabel: Record<TranscriptRow["role"], { glyph: string; color: string }> = {
  user: { glyph: "you ›", color: theme.user },
  assistant: { glyph: "◆", color: theme.assistant },
  system: { glyph: "·", color: theme.system },
  error: { glyph: "!", color: theme.error },
};

/** A Wisp greeting card for the empty/booting transcript — the first thing you see. */
function WispGreeting(props: { subtitle?: string; mood: "idle" | "sad"; hint: string }) {
  const frame = petTerminalFrame(props.mood, 0);
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box>
        <Box flexDirection="column" marginRight={2}>
          {frame.map((line, i) => (
            <WispGlyphLine key={i} parts={line.parts} state={props.mood} />
          ))}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.accent} bold>
            Wisp
          </Text>
          {/* keep a pre-conversation error prominent (red) even inside the card */}
          <Text color={props.mood === "sad" ? theme.error : theme.muted}>
            {props.subtitle ?? "ready when you are ✦"}
          </Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>{props.hint}</Text>
      </Box>
    </Box>
  );
}

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

  const hasConversation = rows.some((r) => r.role === "user" || r.role === "assistant");
  if (!hasConversation && hiddenAbove === 0) {
    // Boot / fresh / post-/clear: greet with Wisp. Surface the latest status
    // (e.g. "Connecting to …") as the subtitle, and frown if it's an error.
    const status = [...rows].reverse().find((r) => r.role === "system" || r.role === "error");
    const hint = `Type a message · /help · ${nativeScroll ? "trackpad scroll" : "Ctrl+O scroll"} · Ctrl+C quit`;
    return (
      <WispGreeting
        subtitle={status?.text}
        mood={status?.role === "error" ? "sad" : "idle"}
        hint={hint}
      />
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
                {row.segments ? (
                  <MarkdownLine segments={row.segments} fallback={row.text} streaming={row.streaming} />
                ) : (
                  <Text color={row.role === "error" ? theme.error : style.color}>
                    {row.text}
                    {row.streaming ? <Text color={theme.muted}>▍</Text> : null}
                  </Text>
                )}
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
