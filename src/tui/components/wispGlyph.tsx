import React from "react";
import { Text } from "ink";
import { theme } from "../theme.js";
import type { PetColorRole, PetGlyph } from "../../petTerminal.js";
import type { PetState } from "../../petState.js";

/** Map a Wisp glyph color role to a theme color (shared by the corner + the greeting). */
export function glyphColor(role: PetColorRole | undefined, state: PetState): string {
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

/** One colored row of Wisp art. */
export function WispGlyphLine(props: { parts: readonly PetGlyph[]; state: PetState }) {
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
