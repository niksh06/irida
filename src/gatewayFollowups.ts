/**
 * Deferred follow-up firing (I-126). Polled by the cron-tick: due follow-ups are
 * run as FRESH isolated agent turns (via runPrompt, NOT a live-session resume —
 * so the gateway's cached peer agent never diverges), and each result is pushed
 * to Telegram through the outbox. One-shot: fired/failed entries are cleared.
 *
 * Respects backgroundPause (no autonomous wake while paused), is bounded per tick
 * (token-spend guard), and prunes stale entries (came due long after the fact,
 * e.g. the host was down) instead of firing them late.
 */
import type { SdkLike } from "./host.js";
import { runPrompt } from "./run.js";
import { isBackgroundPaused } from "./backgroundPause.js";
import { enqueueOutbox } from "./gatewayOutbox.js";
import { SESSION_CHANNEL } from "./sessionChannel.js";
import { dueFollowups, clearFollowup, type DeferredFollowup } from "./gatewayFollowupStore.js";

/** Cap fired follow-ups per tick — a burst shouldn't spike token spend. */
export const FOLLOWUPS_MAX_PER_TICK = 3;

export interface RunFollowupsResult {
  fired: string[];
  failed: string[];
  stale: string[];
  paused: boolean;
}

/** Runs one follow-up prompt and returns the agent's result. Injectable for tests. */
export type FollowupRunner = (prompt: string) => Promise<{ exitCode: number; text: string }>;

/** The fresh-turn prompt for a fired follow-up. Self-contained by contract. */
export function buildFollowupPrompt(reason: string): string {
  return [
    "[deferred follow-up] Earlier in this chat you told the user you would come back about the",
    "following, and that time has now arrived:",
    "",
    `«${reason.trim()}»`,
    "",
    "Carry out or check on that now and reply with the result for the user — concise, in their",
    "language. This is a PROACTIVE one-shot update: do NOT ask the user a question; if you cannot",
    "complete it, say so plainly. You are running in a fresh turn and only see the text above.",
  ].join("\n");
}

/**
 * Fire all due follow-ups (bounded). Pure-ish: side effects are the agent runs,
 * outbox pushes, and store clears. `now`/`sdk` injectable for tests.
 */
export async function runDueFollowups(opts: {
  dir: string;
  sdk?: SdkLike;
  now?: Date;
  max?: number;
  onLog?: (line: string) => void;
  /** Override the agent runner (tests). Defaults to a fresh isolated runPrompt. */
  runner?: FollowupRunner;
}): Promise<RunFollowupsResult> {
  const { dir } = opts;
  const log = opts.onLog ?? ((l: string) => console.error(l));
  const result: RunFollowupsResult = { fired: [], failed: [], stale: [], paused: false };

  if (isBackgroundPaused(dir)) {
    result.paused = true;
    return result;
  }

  const now = opts.now ?? new Date();
  const { due, stale } = dueFollowups(dir, now);

  // Prune stale (host was down past the grace window) — never fire late.
  for (const s of stale) {
    clearFollowup(dir, s.id);
    result.stale.push(s.id);
    log(`[followup] dropped stale ${s.id} chat=${s.chatId} (due ${s.dueAt})`);
  }

  const runner: FollowupRunner =
    opts.runner ??
    ((prompt) =>
      runPrompt(prompt, {
        dir,
        sdk: opts.sdk,
        channel: SESSION_CHANNEL.cron, // autonomous surface → denyDestructive policy applies
        cronJob: "deferred-followup", // run-log attribution for /usage cost
        quiet: true,
      }));

  const batch = due.slice(0, opts.max ?? FOLLOWUPS_MAX_PER_TICK);
  for (const fu of batch) {
    await fireOne(dir, fu, runner, log, result);
  }
  return result;
}

async function fireOne(
  dir: string,
  fu: DeferredFollowup,
  runner: FollowupRunner,
  log: (line: string) => void,
  result: RunFollowupsResult
): Promise<void> {
  log(`[followup] firing ${fu.id} chat=${fu.chatId} reason="${fu.reason.slice(0, 80)}"`);
  try {
    const run = await runner(buildFollowupPrompt(fu.reason));
    const text = run.text?.trim();
    if (run.exitCode === 0 && text) {
      enqueueOutbox(dir, { chatId: fu.chatId, text });
      result.fired.push(fu.id);
      log(`[followup] fired ${fu.id} → outbox (${text.length} chars)`);
    } else {
      enqueueOutbox(dir, {
        chatId: fu.chatId,
        text: `⚠️ Не смог завершить отложенную задачу («${fu.reason.slice(0, 120)}»). Напиши, если нужно ещё раз.`,
      });
      result.failed.push(fu.id);
      log(`[followup] ${fu.id} produced no result (exit=${run.exitCode}) — notified user`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    enqueueOutbox(dir, {
      chatId: fu.chatId,
      text: `⚠️ Отложенная задача упала («${fu.reason.slice(0, 120)}»): ${msg.slice(0, 200)}. Напиши, если нужно повторить.`,
    });
    result.failed.push(fu.id);
    log(`[followup] ${fu.id} error: ${msg}`);
  } finally {
    // One-shot: clear whether it succeeded or failed (the user was notified
    // either way) so a hard error can't loop every tick.
    clearFollowup(dir, fu.id);
  }
}
