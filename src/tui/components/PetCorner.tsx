import React from "react";
import { Box, Text } from "ink";
import { petTerminalFrame, petTerminalLabel, type PetActivityKind } from "../../petTerminal.js";
import type { PetState } from "../../petState.js";
import { WispGlyphLine } from "./wispGlyph.js";

export function PetCorner(props: {
  state: PetState;
  animTick: number;
  activity?: PetActivityKind;
  level?: number;
}) {
  const lines = petTerminalFrame(props.state, props.animTick, props.activity, props.level);

  return (
    <Box flexDirection="column" alignItems="flex-end" marginLeft={1}>
      {lines.map((line, i) => (
        <WispGlyphLine key={i} parts={line.parts} state={props.state} />
      ))}
      <Text dimColor>{petTerminalLabel(props.state, props.activity, props.level)}</Text>
    </Box>
  );
}
