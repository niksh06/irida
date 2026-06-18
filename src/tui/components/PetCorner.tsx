import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import {
  petTerminalFrame,
  petTerminalLabel,
  type PetColorRole,
  type PetGlyph,
} from "../../petTerminal.js";
import type { PetState } from "../../petState.js";

function glyphColor(role: PetColorRole | undefined, state: PetState): string {
  switch (role) {
    case "accent":
      return theme.accent;
    case "warn":
      return theme.statusBusy;
    case "good":
      return theme.statusGood;
    case "muted":
      return theme.muted;
    case "error":
      return theme.error;
    case "primary":
      return theme.primary;
    default:
      break;
  }
  if (state === "sad") return theme.error;
  if (state === "sleep") return theme.muted;
  return theme.primary;
}

function GlyphLine(props: { parts: readonly PetGlyph[]; state: PetState }) {
  return (
    <Text>
      {props.parts.map((g, i) => (
        <Text key={i} color={glyphColor(g.c, props.state)}>
          {g.t}
        </Text>
      ))}
    </Text>
  );
}

export function PetCorner(props: { state: PetState; animTick: number }) {
  const lines = petTerminalFrame(props.state, props.animTick);

  return (
    <Box flexDirection="column" alignItems="flex-end" marginLeft={1}>
      {lines.map((line, i) => (
        <GlyphLine key={i} parts={line.parts} state={props.state} />
      ))}
      <Text dimColor>{petTerminalLabel(props.state)}</Text>
    </Box>
  );
}
