/**
 * Pending-question store (I-125): durable park-and-resume for the agent's
 * clarifying questions over the gateway. The `ask_user` MCP tool (a stdio
 * subprocess with the chat context in its env) writes a pending entry here and
 * ends the turn; the gateway clears it when the user's next message arrives
 * (the answer flows back through the normal per-peer SDK resume) or on /cancel.
 *
 * Path resolution mirrors gatewayPairingStore (`resolve(dir, cfg.stateDir, FILE)`)
 * so the subprocess (dir = CSAGENT_MEMORY_DIR) and the gateway process (dir =
 * the agent home) land on the SAME file — the whole feature depends on that.
 *
 * One pending question per chat (keyed by peerKey). A second ask replaces the
 * first (the agent re-asks); total entries are capped and TTL-expired so an
 * abandoned question is GC'd — expiry is treated as "no pending question", which
 * means a late reply just starts a fresh turn. It NEVER fabricates an answer.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { peerKey } from "./gatewayPeers.js";
import { guardProdStateWrite, writeFileAtomic, nowIso } from "./util.js";

export const PENDING_QUESTIONS_FILE = "gateway.pending-questions.json";
/** Bound the file — a misbehaving agent could otherwise ask in many chats. */
export const PENDING_QUESTIONS_MAX = 50;
/** Same horizon as pairing: a day-old unanswered question is abandoned. */
export const PENDING_QUESTION_TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingQuestion {
  chatId: string;
  adapter: string;
  /** The question the agent asked — surfaced to the user as the turn reply. */
  question: string;
  /** SDK session the question was asked in (informational; resume is per-peer). */
  sessionId?: string;
  createdAt: string;
}

export interface PendingQuestionsFile {
  version: number;
  pending: PendingQuestion[];
}

function pendingPath(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, PENDING_QUESTIONS_FILE);
}

function fresh(p: PendingQuestion, now: number): boolean {
  const t = Date.parse(p.createdAt);
  return Number.isFinite(t) && now - t <= PENDING_QUESTION_TTL_MS;
}

export function loadPendingQuestions(dir: string): PendingQuestionsFile {
  const path = pendingPath(dir);
  if (!existsSync(path)) return { version: 1, pending: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PendingQuestionsFile;
    const now = Date.now();
    const pending = Array.isArray(parsed.pending)
      ? parsed.pending.filter(
          (p) => p && typeof p.question === "string" && typeof p.chatId === "string" && fresh(p, now)
        )
      : [];
    return { version: 1, pending };
  } catch {
    return { version: 1, pending: [] };
  }
}

export function savePendingQuestions(dir: string, data: PendingQuestionsFile): void {
  const path = pendingPath(dir);
  guardProdStateWrite(resolve(path, ".."), PENDING_QUESTIONS_FILE);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileAtomic(path, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Park a question for a chat. Replaces any existing question for the same peer
 * (one pending per chat) and caps the file to the newest PENDING_QUESTIONS_MAX.
 */
export function setPendingQuestion(
  dir: string,
  q: { chatId: string; adapter: string; question: string; sessionId?: string }
): PendingQuestion {
  const file = loadPendingQuestions(dir);
  const key = peerKey(q.adapter, q.chatId);
  const entry: PendingQuestion = {
    chatId: q.chatId,
    adapter: q.adapter,
    question: q.question,
    ...(q.sessionId ? { sessionId: q.sessionId } : {}),
    createdAt: nowIso(),
  };
  const others = file.pending.filter((p) => peerKey(p.adapter, p.chatId) !== key);
  // Newest-first, then cap — a flood of asks in other chats can't evict this one.
  const pending = [entry, ...others].slice(0, PENDING_QUESTIONS_MAX);
  savePendingQuestions(dir, { version: 1, pending });
  return entry;
}

export function getPendingQuestion(
  dir: string,
  adapter: string,
  chatId: string
): PendingQuestion | undefined {
  const key = peerKey(adapter, chatId);
  return loadPendingQuestions(dir).pending.find((p) => peerKey(p.adapter, p.chatId) === key);
}

/** Drop a chat's pending question. Returns true if one was removed. */
export function clearPendingQuestion(dir: string, adapter: string, chatId: string): boolean {
  const file = loadPendingQuestions(dir);
  const key = peerKey(adapter, chatId);
  const pending = file.pending.filter((p) => peerKey(p.adapter, p.chatId) !== key);
  if (pending.length === file.pending.length) return false;
  savePendingQuestions(dir, { version: 1, pending });
  return true;
}
