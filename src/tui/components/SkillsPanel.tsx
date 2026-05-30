import React from "react";
import { Text, useInput } from "ink";
import { loadConfig, ConfigError } from "../../config.js";
import { listSkills } from "../../skills.js";
import { theme } from "../theme.js";
import { OverlayPanel } from "./OverlayPanel.js";

export function SkillsPanel(props: { dir: string; onClose: () => void }) {
  let skills: ReturnType<typeof listSkills> = [];
  let err: string | null = null;
  try {
    const cfg = loadConfig(props.dir);
    skills = listSkills(props.dir, cfg.skillsPath);
  } catch (e) {
    err = e instanceof ConfigError ? e.message : String(e);
  }

  useInput((_input, key) => {
    if (key.escape || key.return) props.onClose();
  });

  return (
    <OverlayPanel title={`Skills (${skills.length})`} footer="Pass --skill name at launch · Esc to close">
      {err ? <Text color={theme.error}>{err}</Text> : null}
      {skills.length === 0 && !err ? (
        <Text color={theme.muted}>No skills under skills/</Text>
      ) : (
        skills.slice(0, 12).map((s) => (
          <Text key={s.name} wrap="wrap">
            <Text color={theme.accent}>{s.name.padEnd(14)}</Text>
            <Text dimColor>{(s.description || "—").slice(0, 48)}</Text>
          </Text>
        ))
      )}
      {skills.length > 12 ? <Text dimColor>…and {skills.length - 12} more</Text> : null}
    </OverlayPanel>
  );
}
