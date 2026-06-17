/**
 * Archive wing retention purge (I-80) — TTL and optional lesson-gated delete.
 */
import { createMemoryStore, type IMemoryStore } from "./memoryStore.js";
import { CURSOR_LESSON_WING, CURSOR_TRANSCRIPT_WING } from "./memoryWings.js";

/** Default raw archive TTL per MEMORY-GOVERNANCE D2. */
export const DEFAULT_ARCHIVE_RETENTION_DAYS = 180;

export interface PurgeArchiveOptions {
  wing?: string;
  olderThanDays?: number;
  /** When true, only purge cursor.* notes with a matching lesson.{uuid} note. */
  requireLesson?: boolean;
  /** When true, delete matched notes (default is dry-run). */
  apply?: boolean;
}

export interface PurgeArchiveCandidate {
  name: string;
  updatedAt: string;
  reason: string;
}

export interface PurgeArchiveResult {
  dryRun: boolean;
  wing: string;
  olderThanDays: number;
  requireLesson: boolean;
  matched: number;
  deleted: number;
  candidates: PurgeArchiveCandidate[];
}

function parseNoteTime(iso: string | undefined): number | null {
  if (!iso?.trim()) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function lessonNameForArchive(name: string): string | undefined {
  if (!name.startsWith("cursor.")) return undefined;
  const suffix = name.slice("cursor.".length).trim();
  return suffix ? `lesson.${suffix}` : undefined;
}

export async function collectArchivePurgeCandidates(
  store: IMemoryStore,
  opts: PurgeArchiveOptions = {}
): Promise<PurgeArchiveCandidate[]> {
  const wing = opts.wing?.trim() || CURSOR_TRANSCRIPT_WING;
  const olderThanDays = opts.olderThanDays ?? DEFAULT_ARCHIVE_RETENTION_DAYS;
  const requireLesson = opts.requireLesson === true;
  const cutoffMs = Date.now() - olderThanDays * 86_400_000;
  const notes = await store.listNotes(wing);
  const candidates: PurgeArchiveCandidate[] = [];

  for (const note of notes) {
    const updatedMs = parseNoteTime(note.updated_at);
    if (updatedMs == null || updatedMs >= cutoffMs) continue;

    if (requireLesson) {
      const lessonName = lessonNameForArchive(note.name);
      if (!lessonName) continue;
      const lesson = await store.getNote(lessonName);
      if (!lesson || lesson.wing !== CURSOR_LESSON_WING) continue;
      candidates.push({
        name: note.name,
        updatedAt: note.updated_at,
        reason: `older than ${olderThanDays}d + lesson ${lessonName}`,
      });
      continue;
    }

    candidates.push({
      name: note.name,
      updatedAt: note.updated_at,
      reason: `older than ${olderThanDays}d`,
    });
  }

  return candidates;
}

export async function purgeArchiveNotes(
  dir: string,
  opts: PurgeArchiveOptions = {}
): Promise<PurgeArchiveResult> {
  const wing = opts.wing?.trim() || CURSOR_TRANSCRIPT_WING;
  const olderThanDays = opts.olderThanDays ?? DEFAULT_ARCHIVE_RETENTION_DAYS;
  const requireLesson = opts.requireLesson === true;
  const dryRun = opts.apply !== true;
  const store = createMemoryStore(dir);
  try {
    const candidates = await collectArchivePurgeCandidates(store, opts);
    let deleted = 0;
    if (!dryRun) {
      for (const c of candidates) {
        if (await store.deleteNote(c.name)) deleted++;
      }
    }
    return {
      dryRun,
      wing,
      olderThanDays,
      requireLesson,
      matched: candidates.length,
      deleted,
      candidates,
    };
  } finally {
    await store.close();
  }
}
