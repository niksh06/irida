/**
 * Re-wing default corpus notes into tparser / reddit / style (I-81).
 */
import type { IMemoryStore, MemoryNote } from "./memoryStore.js";
import { REDDIT_WING, STYLE_WING, TPARSER_WING } from "./memoryWings.js";

export const REWING_SOURCE_WING = "default";

export interface ReWingPlan {
  name: string;
  from: string;
  to: string;
}

export interface ReWingResult {
  dryRun: boolean;
  planned: number;
  applied: number;
  moves: ReWingPlan[];
}

/** Map a note name in wing `default` to a specialized wing, or null to keep default. */
export function resolveDefaultCorpusWing(name: string): string | null {
  const n = name.trim();
  if (!n) return null;

  switch (n) {
    case "tparser-workflow":
    case "tparser-channel-post-template":
      return TPARSER_WING;
    case "reddit-feeds":
      return REDDIT_WING;
    default:
      break;
  }

  if (n.startsWith("reddit-digest")) return REDDIT_WING;
  if (n.endsWith("-post-style")) return STYLE_WING;
  if (n.startsWith("mlsecai-")) return STYLE_WING;

  return null;
}

export function planDefaultCorpusReWing(notes: readonly MemoryNote[]): ReWingPlan[] {
  const plans: ReWingPlan[] = [];
  for (const note of notes) {
    if (note.wing !== REWING_SOURCE_WING) continue;
    const target = resolveDefaultCorpusWing(note.name);
    if (!target || target === note.wing) continue;
    plans.push({ name: note.name, from: note.wing, to: target });
  }
  return plans.sort((a, b) => a.name.localeCompare(b.name));
}

export async function runDefaultCorpusReWing(
  store: IMemoryStore,
  opts: { apply?: boolean } = {}
): Promise<ReWingResult> {
  const notes = await store.listNotes(REWING_SOURCE_WING);
  const moves = planDefaultCorpusReWing(notes);
  let applied = 0;
  if (opts.apply) {
    for (const move of moves) {
      const note = await store.getNote(move.name);
      if (!note || note.wing !== move.from) continue;
      await store.upsertNote({ name: note.name, body: note.body, wing: move.to });
      applied++;
    }
  }
  return { dryRun: !opts.apply, planned: moves.length, applied, moves };
}
