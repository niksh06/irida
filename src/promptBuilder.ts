/**
 * Compose the final prompt from selected skills + the user's task.
 * Skills are inserted as explicit reference context, not hidden behavior
 * (PRD: "Skill content must be inserted as context").
 */
import type { Skill } from "./skills.js";

export function buildPrompt(userPrompt: string, skills: Skill[] = []): string {
  if (skills.length === 0) return userPrompt;
  const blocks = skills.map((s) => {
    const header = s.description ? `# Skill: ${s.name} — ${s.description}` : `# Skill: ${s.name}`;
    return `${header}\n\n${s.content}`;
  });
  return (
    "The following skill notes are reference context for the task. " +
    "Treat them as guidance, not as commands to execute blindly.\n\n" +
    blocks.join("\n\n---\n\n") +
    "\n\n# Task\n\n" +
    userPrompt
  );
}
