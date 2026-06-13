/**
 * Compose user prompt: memory, context refs, then optional skills (issue 014 + 036).
 */
import { expandContextRefs, ContextRefError } from "./contextRefs.js";
import { expandMemoryRefs, MemoryError } from "./memory.js";
import { buildPrompt } from "./promptBuilder.js";
import type { Skill } from "./skills.js";

export { ContextRefError, MemoryError };

const TASK_MARKER = "\n\n# Task\n\n";

function insertBeforeTask(text: string, insertion: string): string {
  const idx = text.indexOf(TASK_MARKER);
  if (idx >= 0) {
    return text.slice(0, idx) + "\n\n" + insertion + text.slice(idx);
  }
  const trimmed = text.trim();
  return `${insertion}${TASK_MARKER}${trimmed || "(see attached memory)"}`;
}

export async function composePrompt(args: {
  userPrompt: string;
  cwd: string;
  dir?: string;
  skills?: Skill[];
  /** Pre-loaded memory blocks (first session turn). */
  sessionMemoryBlocks?: string[];
  /** Mode + profile blocks (I-52 preTurn). */
  preTurnBlocks?: string[];
  /** Auto-retrieved memory blocks for this message (Wave B auto-RAG). */
  autoRagBlocks?: string[];
}): Promise<string> {
  const dir = args.dir ?? args.cwd;
  let text = await expandMemoryRefs(args.userPrompt, dir, args.sessionMemoryBlocks ?? []);
  if (args.autoRagBlocks?.length) {
    const section =
      "Relevant memory (retrieved for this message):\n\n" + args.autoRagBlocks.join("\n\n");
    text = insertBeforeTask(text, section);
  }
  if (args.preTurnBlocks?.length) {
    text = args.preTurnBlocks.join("\n\n") + "\n\n" + text;
  }
  text = expandContextRefs(text, args.cwd);
  if (args.skills && args.skills.length) return buildPrompt(text, args.skills);
  return text;
}
