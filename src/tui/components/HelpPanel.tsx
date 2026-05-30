import React from "react";
import { Text, useInput } from "ink";
import { theme } from "../theme.js";
import { SLASH_HELP } from "../slash.js";
import { OverlayPanel } from "./OverlayPanel.js";

export function HelpPanel(props: { onClose: () => void }) {
  useInput((_input, key) => {
    if (key.escape || key.return) props.onClose();
  });

  return (
    <OverlayPanel title="csagent tui — commands" footer="Esc or Enter to close">
      <Text color={theme.muted}>{SLASH_HELP}</Text>
    </OverlayPanel>
  );
}
