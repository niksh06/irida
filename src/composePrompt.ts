/**
 * Compose user prompt: context refs, then optional skills (issue 014 + skills).
 */
import { expandContextRefs, ContextRefError } from "./contextRefs.js";
import { buildPrompt } from "./promptBuilder.js";
import type { Skill } from "./skills.js";

export { ContextRefError };

export function composePrompt(args: {
  userPrompt: string;
  cwd: string;
  skills?: Skill[];
}): string {
  const withRefs = expandContextRefs(args.userPrompt, args.cwd);
  if (args.skills && args.skills.length) return buildPrompt(withRefs, args.skills);
  return withRefs;
}
