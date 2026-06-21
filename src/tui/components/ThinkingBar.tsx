import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

// A smooth braille orbit — the "engine" pulse while the agent reasons.
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
// A sparkle that drifts back and forth — shares Wisp's visual language so the
// thinking line and the mascot read as one creature.
const WAVE = ["✦ · ·", "· ✦ ·", "· · ✦", "· ✦ ·"] as const;

const wrap = (tick: number, n: number) => ((tick % n) + n) % n;

/** Pure: the braille spinner glyph for an animation tick. */
export function thinkingSpinner(tick: number): string {
  return SPINNER[wrap(tick, SPINNER.length)]!;
}

/** Pure: the drifting-sparkle trail for an animation tick. */
export function thinkingWave(tick: number): string {
  return WAVE[wrap(tick, WAVE.length)]!;
}

export function ThinkingBar(props: {
  text: string;
  expanded: boolean;
  tick?: number;
  elapsedMs?: number;
}) {
  const { text, expanded, tick = 0, elapsedMs } = props;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const preview = trimmed.replace(/\s+/g, " ");
  const shown =
    expanded || preview.length <= 100 ? trimmed : `${preview.slice(0, 100).trimEnd()}…`;
  const secs = elapsedMs && elapsedMs >= 1000 ? ` ${Math.floor(elapsedMs / 1000)}s` : "";

  return (
    <Box flexDirection="column" paddingX={1} marginTop={0}>
      <Text>
        <Text color={theme.accent}>{thinkingSpinner(tick)}</Text>
        <Text color={theme.statusBusy}> thinking</Text>
        {secs ? <Text dimColor>{secs}</Text> : null}
        <Text color={theme.accent}>
          {"   "}
          {thinkingWave(tick)}
        </Text>
        {!expanded && preview.length > 100 ? <Text dimColor>{"   "}Ctrl+T expand</Text> : null}
      </Text>
      <Text wrap="wrap" dimColor>
        {shown}
      </Text>
    </Box>
  );
}
