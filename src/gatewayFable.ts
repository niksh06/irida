/**
 * /fable gateway command (I-160): the owner's Telegram line to the interactive
 * Fable session (Claude Code on this machine). Bare `/fable` shows channel
 * status; `/fable <text>` drops the text into state/fable-inbox.jsonl in the
 * ouroboros repo, where the session's polling loop picks it up and replies to
 * Telegram via `npm run fable:send`.
 *
 * Same decoupling rule as /vesper: path-only access to the ouroboros state
 * dir, no imports of ouroboros code. The gateway allowlist already gates who
 * can invoke commands, so everything landing here is from an approved chat.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ouroborosRoot } from "./gatewayVesper.js";

export function fableInboxPath(root: string = ouroborosRoot()): string {
  return resolve(root, "state", "fable-inbox.jsonl");
}

function readLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
}

/** Compact status for bare `/fable`. */
export function fableStatus(root: string = ouroborosRoot()): string {
  if (!existsSync(root)) return `fable: ouroboros-репо не найдено (${root})`;
  const lines = readLines(fableInboxPath(root));
  const out = ["◆ Fable — интерактивная сессия (дежурный наставник)"];
  if (lines.length) {
    try {
      const last = JSON.parse(lines[lines.length - 1]!);
      out.push(`Сообщений в лотке: ${lines.length}, последнее ${String(last.ts ?? "?")}`);
    } catch {
      out.push(`Сообщений в лотке: ${lines.length}`);
    }
  } else {
    out.push("Лоток пуст.");
  }
  out.push("Написать: /fable <текст> — сессия поллит лоток и ответит сюда же в Telegram.");
  return out.join("\n");
}

/** `/fable <text>` → the session's inbox file. */
export function fableTell(text: string, root: string = ouroborosRoot(), now: Date = new Date()): string {
  const t = text.trim();
  if (!t) return fableStatus(root);
  if (!existsSync(root)) return `fable: ouroboros-репо не найдено (${root})`;
  const inbox = fableInboxPath(root);
  mkdirSync(dirname(inbox), { recursive: true });
  appendFileSync(inbox, JSON.stringify({ ts: now.toISOString(), text: t }) + "\n");
  return "✉ Fable, увидит на ближайшей проверке лотка (обычно до получаса).";
}
