import React from "react";
import { Text, useInput } from "ink";
import { theme } from "../theme.js";
import { listMemories } from "../../memory.js";
import { OverlayPanel } from "./OverlayPanel.js";

export function MemoryPanel(props: { dir: string; onClose: () => void }) {
  const entries = listMemories(props.dir);

  useInput((_input, key) => {
    if (key.escape || key.return) props.onClose();
  });

  return (
    <OverlayPanel
      title={`Memory (${entries.length})`}
      footer="Inject with @memory:<name> or @memory: · Esc to close"
    >
      {entries.length === 0 ? (
        <Text color={theme.muted}>No memories — irida memory add &lt;name&gt; --stdin</Text>
      ) : (
        entries.map((m) => (
          <Text key={m.name} wrap="wrap">
            <Text color={theme.accent}>{m.name.padEnd(14)}</Text>
            <Text dimColor>{m.preview || m.title}</Text>
          </Text>
        ))
      )}
    </OverlayPanel>
  );
}
