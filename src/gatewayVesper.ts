/**
 * /vesper gateway command (I-158): the owner's Telegram-side of the channel to
 * the ouroboros agent. Bare `/vesper` shows a compact status; `/vesper <text>`
 * drops the text into the agent's inbox (same jsonl shape the ouroboros
 * orchestrator delivers into the next wake prompt).
 *
 * This module only touches the ouroboros STATE files by path — no import of
 * ouroboros code, so the gateway stays decoupled from the ward's runtime.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { dualEnv } from "./env.js";

/** Ouroboros repo root (override: IRIDA_OUROBOROS_ROOT / CSAGENT_OUROBOROS_ROOT). */
export function ouroborosRoot(): string {
  const fromEnv = dualEnv("OUROBOROS_ROOT");
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : resolve(homedir(), "Downloads", "ouroboros");
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function lastJsonlEntry(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return null;
  try {
    return JSON.parse(last);
  } catch {
    return null;
  }
}

function countPendingProposals(root: string): number {
  const p = resolve(root, "state", "proposals.jsonl");
  if (!existsSync(p)) return 0;
  return readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((line) => {
      try {
        return JSON.parse(line).status === "pending";
      } catch {
        return false;
      }
    }).length;
}

/** Compact status for bare `/vesper`. */
export function vesperStatus(root: string = ouroborosRoot()): string {
  if (!existsSync(root)) return `vesper: репо не найдено (${root})`;
  const name = (readJson(resolve(root, "state", "name.json"))?.name as string) || "агент (без имени)";
  const nw = readJson(resolve(root, "state", "next-wake.json"));
  const last = lastJsonlEntry(resolve(root, "state", "journal.jsonl"));
  const pending = countPendingProposals(root);
  const lines = [`◆ ${name}`];
  if (last) {
    const decision = (last.decision as string) || (last.kind as string) || "?";
    lines.push(`Последнее пробуждение: ${decision} (${last.mode ?? "?"}) — ${String(last.reason ?? "").slice(0, 160)}`);
  } else {
    lines.push("Ещё не просыпался.");
  }
  if (nw?.at) {
    const ms = Date.parse(String(nw.at)) - Date.now();
    const mins = Math.max(0, Math.round(ms / 60000));
    lines.push(ms > 0 ? `Спит; проснётся через ${Math.floor(mins / 60)}ч ${mins % 60}м (${nw.mode ?? ""})` : "Пора вставать — проснётся на ближайшем тике.");
  }
  lines.push(pending > 0 ? `Предложений ждёт решения: ${pending}` : "Предложений в очереди нет.");
  lines.push("Написать ему: /vesper <текст>");
  return lines.join("\n");
}

/** `/vesper <text>` → the agent's inbox (delivered into his next wake prompt). */
export function vesperTell(text: string, root: string = ouroborosRoot(), now: Date = new Date()): string {
  const t = text.trim();
  if (!t) return vesperStatus(root);
  if (!existsSync(root)) return `vesper: репо не найдено (${root})`;
  const inbox = resolve(root, "state", "inbox.jsonl");
  mkdirSync(dirname(inbox), { recursive: true });
  appendFileSync(inbox, JSON.stringify({ ts: now.toISOString(), text: t }) + "\n");
  const nw = readJson(resolve(root, "state", "next-wake.json"));
  let when = "на следующем пробуждении";
  if (nw?.at) {
    const ms = Date.parse(String(nw.at)) - now.getTime();
    if (Number.isFinite(ms) && ms > 0) {
      const mins = Math.max(0, Math.round(ms / 60000));
      when = `через ~${Math.floor(mins / 60)}ч ${mins % 60}м`;
    }
  }
  return `✉ Весперу, прочтёт ${when}.`;
}
