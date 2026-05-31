/**
 * Compose user prompt: memory, context refs, then optional skills (issue 014 + 036).
 */
import { expandContextRefs, ContextRefError } from "./contextRefs.js";
import { expandMemoryRefs, MemoryError } from "./memory.js";
import { buildPrompt } from "./promptBuilder.js";
import type { Skill } from "./skills.js";

export { ContextRefError, MemoryError };

export function composePrompt(args: {
  userPrompt: string;
  cwd: string;
  dir?: string;
  skills?: Skill[];
  /** Pre-loaded memory blocks (first session turn). */
  sessionMemoryBlocks?: string[];
}): string {
  const dir = args.dir ?? args.cwd;
  let text = expandMemoryRefs(args.userPrompt, dir, args.sessionMemoryBlocks ?? []);
  text = expandContextRefs(text, args.cwd);
  if (args.skills && args.skills.length) return buildPrompt(text, args.skills);
  return text;
}
