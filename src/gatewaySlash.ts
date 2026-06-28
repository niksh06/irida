/**
 * irida gateway slash commands (I-22) — Telegram/webhook, no LLM.
 * Branded irida catalog; not Hermes COMMAND_REGISTRY.
 */
import { gatherDoctorChecks, doctorAllOk } from "./doctorChecks.js";
import { gatherGatewayStatus } from "./gatewayStatus.js";
import { loadGatewayConfig, type GatewayConfig } from "./gatewayConfig.js";
import { loadGatewayPeers, peerKey } from "./gatewayPeers.js";
import { tryApprovePairing } from "./gatewayPairing.js";
import { backgroundPauseState, setBackgroundPaused } from "./backgroundPause.js";
import { createMemoryStore } from "./memoryStore.js";
import { loadConfig } from "./config.js";
import { loadRunMetrics, formatRunMetrics, loadSessionUsage, formatSessionUsage } from "./runMetrics.js";
import { loadProposals } from "./evolutionCycle.js";
import { loadSkillLedger, rollbackAgentSkill } from "./skillApply.js";
import { getChatMode, setChatMode, clearChatMode } from "./gatewayModeStore.js";
import { clearPendingQuestion } from "./gatewayPendingQuestionStore.js";
import { parseModeArg, TURN_MODES } from "./preTurn.js";
import { createStore } from "./store.js";
import { searchSessions } from "./sessionSearch.js";
import { listSkills } from "./skills.js";
import {
  addUserCronJob,
  approveCronSchedule,
  listCronJobsText,
  listPendingCronSchedulesText,
  parseScheduleAddArgs,
  removeUserCronJob,
  scheduleSlashHelpText,
} from "./cronScheduleOps.js";
import { runDelegate } from "./delegateRun.js";
import { undoLastAction } from "./undoAction.js";
import type { ChatSession } from "./chatEngine.js";

import {
  gatewaySlashCommands,
  gatewaySlashHelpLines,
  slashRegistryHasCommand,
  telegramBotCommandsFromRegistry,
} from "./slashRegistry.js";

export type GatewaySlashCommand = ReturnType<typeof gatewaySlashCommands>[number];

/** irida commands available in messaging gateways (from unified registry). */
export const GATEWAY_SLASH_COMMANDS = gatewaySlashCommands();

/** Telegram Bot API menu entries (setMyCommands) — same catalog as /help. */
export function gatewayTelegramBotCommands(): Array<{ command: string; description: string }> {
  return telegramBotCommandsFromRegistry();
}

export function gatewaySlashHelpText(): string {
  const lines = gatewaySlashHelpLines();
  return [
    "**irida** — команды бота:",
    "",
    ...lines,
    "",
    "**После digest:** `топ-50`, `только InfoSec`, `только AI`, `only devops` → углубление по теме.",
    "",
    "**Cron из чата:** попроси агента запланировать → `/schedule approve <код>` · fallback: `/schedule help`",
    "",
    "Свободный текст → агент (Cursor SDK).",
  ].join("\n");
}

export function parseGatewaySlash(text: string): { cmd: string; arg: string } | null {
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  const [raw, ...rest] = t.slice(1).split(/\s+/);
  if (!raw) return { cmd: "help", arg: "" };
  // Telegram groups append @BotUsername to slash commands.
  const cmd = (raw.split("@")[0] ?? raw).toLowerCase();
  return { cmd, arg: rest.join(" ").trim() };
}

export function isGatewaySlashCommand(text: string): boolean {
  const p = parseGatewaySlash(text);
  if (!p) return false;
  return slashRegistryHasCommand(p.cmd, "gateway");
}

export interface GatewaySlashContext {
  dir: string;
  adapter: string;
  chatId: string;
  cfg: GatewayConfig;
  skills: string[];
  /** Required for /delegate — inject summary into the peer session. */
  getSession?: () => Promise<ChatSession>;
  yesIUnderstand?: boolean;
}

export async function handleGatewaySlash(
  text: string,
  ctx: GatewaySlashContext
): Promise<string | null> {
  const p = parseGatewaySlash(text);
  if (!p) return null;
  const cmd = p.cmd === "mem" ? "memory" : p.cmd;

  switch (cmd) {
    case "help":
    case "start":
      return gatewaySlashHelpText();

    case "status": {
      const rows = gatherGatewayStatus(ctx.dir);
      const lines = rows.map((r) => `${r.ok ? "OK" : "FAIL"} ${r.name}: ${r.detail}`);
      return ["irida gateway status", ...lines].join("\n");
    }

    case "doctor": {
      const checks = gatherDoctorChecks(ctx.dir);
      const lines = checks.map((c) => `${c.ok ? "OK" : "FAIL"} ${c.name}: ${c.detail}`);
      const all = doctorAllOk(checks);
      return [`irida doctor (${all ? "pass" : "fail"})`, ...lines].join("\n");
    }

    case "usage": {
      const cfg = loadConfig(ctx.dir);
      const m = loadRunMetrics(ctx.dir, cfg.stateDir, 24, { prodOnly: true });
      const lines = [`irida usage`, `24h: ${formatRunMetrics(m, 24, { prodOnly: true })}`];
      const sid = loadGatewayPeers(ctx.dir).peers[peerKey(ctx.adapter, ctx.chatId)];
      if (sid) lines.push(formatSessionUsage(loadSessionUsage(ctx.dir, cfg.stateDir, sid)));
      const account =
        cfg.engine.provider === "claude-agent" && (cfg.engine.auth ?? "api-key") === "account";
      if (account && m.costUsd != null) lines.push("(account/subscription — $ is metered-equivalent, not billed)");
      return lines.join("\n");
    }

    case "proposals": {
      const arg = p.arg.trim();
      // `proposals rollback <skill>` — human-owned undo of an auto-applied skill (I-98 L1).
      const rb = arg.match(/^rollback\s+(.+)$/i);
      if (rb) {
        const name = rb[1].trim();
        const res = rollbackAgentSkill(ctx.dir, loadConfig(ctx.dir).skillsPath, name);
        return res.ok ? `rolled back skill "${name}": ${res.reason}` : `rollback failed: ${res.reason}`;
      }

      const out: string[] = [];
      const pending = loadProposals(ctx.dir).proposals.filter((p) => p.status === "pending");
      if (pending.length) {
        out.push(
          `evolution proposals — ${pending.length} pending (review & apply manually):`,
          ...pending.map((p) => `• [${p.kind}] ${p.title}\n  ${p.detail.replace(/\s+/g, " ").slice(0, 220)}\n  (${p.id})`)
        );
      }
      // Auto-applied skills (I-98 L1) — what the loop changed on its own + how to undo.
      const applied = loadSkillLedger(ctx.dir).applied.slice(0, 8);
      if (applied.length) {
        if (out.length) out.push("");
        out.push("auto-applied skills (evolution L1):");
        for (const s of applied) {
          const score = s.evalScore != null ? ` fitness ${s.evalScore.toFixed(2)}` : "";
          const flag = s.status === "rolled-back" ? " [rolled-back]" : "";
          out.push(`• ${s.name}${score}${flag} — ${s.at.slice(0, 10)}`);
        }
        out.push("undo: /proposals rollback <skill>");
      }
      return out.length ? out.join("\n") : "evolution: no pending proposals or auto-applied skills";
    }

    case "mode": {
      const arg = p.arg.trim().toLowerCase();
      if (!arg) {
        const cur = getChatMode(ctx.dir, ctx.adapter, ctx.chatId);
        return cur
          ? `mode: **${cur}** (sticky). Change: /mode ${TURN_MODES.join("|")} · clear: /mode off`
          : `mode: none (per-message prefix or default). Set sticky: /mode ${TURN_MODES.join("|")}`;
      }
      if (arg === "off" || arg === "clear" || arg === "none") {
        const had = clearChatMode(ctx.dir, ctx.adapter, ctx.chatId);
        return had ? "mode cleared — back to per-message / default" : "mode was not set";
      }
      const mode = parseModeArg(arg);
      if (!mode) return `unknown mode «${arg}». Use: ${TURN_MODES.join(" | ")} (or off)`;
      setChatMode(ctx.dir, ctx.adapter, ctx.chatId, mode);
      return `mode → **${mode}** (sticky; applies to messages without an explicit ADVICE:/DO:/… prefix)`;
    }

    case "cancel": {
      // I-125: abandon a parked clarifying question without resetting the session.
      const had = clearPendingQuestion(ctx.dir, ctx.adapter, ctx.chatId);
      return had
        ? "Снял ожидание ответа на вопрос агента. Пиши что угодно — продолжим с нового."
        : "Нет ожидающего вопроса от агента.";
    }

    case "memory": {
      const q = p.arg.trim();
      const memCfg = loadConfig(ctx.dir);
      const store = createMemoryStore(ctx.dir, memCfg.stateDir);
      try {
        if (!q || q.toLowerCase() === "list") {
          const notes = await store.listNotes();
          if (notes.length === 0) return "Память пуста.";
          const head = notes.slice(0, 15).map((n) => `• ${n.name} [${n.wing}] ${n.title}`);
          const tail = notes.length > 15 ? `\n…ещё ${notes.length - 15}` : "";
          return ["irida memory:", ...head].join("\n") + tail;
        }
        const hits = await store.searchNotes(q, 10);
        if (hits.length === 0) return `Нет совпадений по «${q}».`;
        return [
          `irida memory search: «${q}»`,
          ...hits.map(
            (n) =>
              `• ${n.name}: ${n.body.replace(/\s+/g, " ").trim().slice(0, 120)}`
          ),
        ].join("\n");
      } finally {
        await store.close();
      }
    }

    case "sessions": {
      const peers = loadGatewayPeers(ctx.dir);
      const key = peerKey(ctx.adapter, ctx.chatId);
      const sessionId = peers.peers[key];
      const memCfg = loadConfig(ctx.dir);
      const store = createStore(ctx.dir, memCfg.stateDir);
      try {
        const hits = await searchSessions(store, p.arg || "", {
          channel: ctx.adapter,
          limit: 10,
        });
        const lines = hits.map(
          (s) => `${s.id} [${s.last_status || "?"}] ${(s.title || "").slice(0, 60)}`
        );
        const cur = sessionId ? `\nТекущая: ${sessionId}` : "";
        if (lines.length === 0) return `Нет сессий.${cur}`;
        return [`irida sessions:`, ...lines, cur].join("\n");
      } finally {
        await store.close();
      }
    }

    case "skills": {
      const configured = ctx.skills.length ? ctx.skills : ctx.cfg.skills;
      if (configured.length) {
        return `irida skills (gateway): ${configured.join(", ")}`;
      }
      const cfg = loadConfig(ctx.dir);
      const all = listSkills(ctx.dir, cfg.skillsPath).slice(0, 12);
      if (all.length === 0) return "Нет skills в каталоге skills/.";
      return ["irida skills:", ...all.map((s) => `• ${s.name}: ${s.description.slice(0, 60)}`)].join(
        "\n"
      );
    }

    case "approve": {
      if (!p.arg) return "Использование: /approve <код>";
      const out = await tryApprovePairing(ctx.dir, ctx.chatId, p.arg);
      return out.message;
    }

    case "pause": {
      const reason = p.arg.trim() || `gateway chat ${ctx.chatId}`;
      setBackgroundPaused(ctx.dir, true, reason);
      return `⏸ Фоновые задачи на паузе — ${reason}. Cron не запускает задания (отвечаю только на твои сообщения). /resume чтобы снять.`;
    }

    case "resume": {
      setBackgroundPaused(ctx.dir, false);
      const st = backgroundPauseState(ctx.dir);
      if (st.paused && st.source === "env") {
        return "Флаг снят, но CSAGENT_PAUSE_BACKGROUND ещё установлен — фон остаётся на паузе.";
      }
      return "▶️ Фоновые задачи возобновлены — cron снова запускает задания по расписанию.";
    }

    case "delegate": {
      const prompt = p.arg.trim();
      if (!prompt) return "Использование: /delegate <prompt>";
      if (!ctx.getSession) return "delegate недоступен (нет сессии)";
      const session = await ctx.getSession();
      const out = await runDelegate({
        dir: ctx.dir,
        prompt,
        skills: ctx.skills.length ? ctx.skills : ctx.cfg.skills,
        yesIUnderstand: ctx.yesIUnderstand,
      });
      if (out.ok) {
        await session.injectContext(`[delegate] ${prompt}`, out.summary);
        return `[delegate]\n${out.summary}`;
      }
      return `Delegate failed: ${out.summary}`;
    }

    case "undo": {
      const out = await undoLastAction(ctx.dir);
      return out.message;
    }

    case "schedule": {
      const sub = (p.arg.split(/\s+/)[0] ?? "").toLowerCase();
      const rest = p.arg.slice(sub.length).trim();
      switch (sub) {
        case "":
        case "help":
          return scheduleSlashHelpText();
        case "list":
          return listCronJobsText(ctx.dir, "all");
        case "user":
          return listCronJobsText(ctx.dir, "user");
        case "pending":
          return listPendingCronSchedulesText(ctx.dir, ctx.chatId);
        case "add": {
          const draft = parseScheduleAddArgs(`add ${rest}`);
          if (!draft) {
            return "Использование: /schedule add `<cron>` `<id>` `<prompt…>`\nПример: /schedule add 0 9 * * 1 weekly-inbox Summarize tasks";
          }
          const out = addUserCronJob(ctx.dir, draft, {
            chatId: ctx.chatId,
            telegram: true,
          });
          return out.message;
        }
        case "remove": {
          if (!rest) return "Использование: /schedule remove `<id>`";
          return removeUserCronJob(ctx.dir, rest.split(/\s+/)[0]!).message;
        }
        case "approve": {
          if (!rest) return "Использование: /schedule approve `<код>`";
          return approveCronSchedule(ctx.dir, rest.split(/\s+/)[0]!, ctx.chatId).message;
        }
        default:
          return scheduleSlashHelpText();
      }
    }

    default:
      return null;
  }
}
