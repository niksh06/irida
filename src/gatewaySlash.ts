/**
 * csagent gateway slash commands (I-22) — Telegram/webhook, no LLM.
 * Branded csagent catalog; not Hermes COMMAND_REGISTRY.
 */
import { gatherDoctorChecks, doctorAllOk } from "./doctorChecks.js";
import { gatherGatewayStatus } from "./gatewayStatus.js";
import { loadGatewayConfig, type GatewayConfig } from "./gatewayConfig.js";
import { loadGatewayPeers, peerKey } from "./gatewayPeers.js";
import { tryApprovePairing } from "./gatewayPairing.js";
import { createMemoryStore } from "./memoryStore.js";
import { loadConfig } from "./config.js";
import { createStore } from "./store.js";
import { searchSessions } from "./sessionSearch.js";
import { listSkills } from "./skills.js";

export interface GatewaySlashCommand {
  cmd: string;
  desc: string;
  args?: string;
  /** Shown in /help for Telegram. */
  telegram?: boolean;
}

/** csagent commands available in messaging gateways. */
export const GATEWAY_SLASH_COMMANDS: GatewaySlashCommand[] = [
  { cmd: "help", desc: "Список команд csagent", telegram: true },
  { cmd: "new", desc: "Новая сессия (сброс контекста)", telegram: true },
  { cmd: "status", desc: "Статус gateway и launchd", telegram: true },
  { cmd: "doctor", desc: "Краткая проверка окружения", telegram: true },
  { cmd: "memory", desc: "Поиск в памяти", args: "<запрос>", telegram: true },
  { cmd: "sessions", desc: "Последние сессии (этот чат)", telegram: true },
  { cmd: "skills", desc: "Skills из gateway.json", telegram: true },
  { cmd: "approve", desc: "Подтвердить pairing-код", args: "<код>", telegram: true },
];

/** Telegram Bot API menu entries (setMyCommands) — same catalog as /help. */
export function gatewayTelegramBotCommands(): Array<{ command: string; description: string }> {
  return GATEWAY_SLASH_COMMANDS.filter((c) => c.telegram !== false).map((c) => {
    const desc = c.args ? `${c.desc} ${c.args}` : c.desc;
    return {
      command: c.cmd.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 32),
      description: desc.slice(0, 256),
    };
  });
}

export function gatewaySlashHelpText(): string {
  const lines = GATEWAY_SLASH_COMMANDS.filter((c) => c.telegram !== false).map((c) => {
    const usage = c.args ? `/${c.cmd} ${c.args}` : `/${c.cmd}`;
    return `${usage} — ${c.desc}`;
  });
  return ["**csagent** — команды бота:", "", ...lines, "", "Свободный текст → агент (Cursor SDK)."].join(
    "\n"
  );
}

export function parseGatewaySlash(text: string): { cmd: string; arg: string } | null {
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  const [raw, ...rest] = t.slice(1).split(/\s+/);
  if (!raw) return { cmd: "help", arg: "" };
  return { cmd: raw.toLowerCase(), arg: rest.join(" ").trim() };
}

export function isGatewaySlashCommand(text: string): boolean {
  const p = parseGatewaySlash(text);
  if (!p) return false;
  return GATEWAY_SLASH_COMMANDS.some((c) => c.cmd === p.cmd) || p.cmd === "mem";
}

export interface GatewaySlashContext {
  dir: string;
  adapter: string;
  chatId: string;
  cfg: GatewayConfig;
  skills: string[];
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
      return ["csagent gateway status", ...lines].join("\n");
    }

    case "doctor": {
      const checks = gatherDoctorChecks(ctx.dir);
      const lines = checks.map((c) => `${c.ok ? "OK" : "FAIL"} ${c.name}: ${c.detail}`);
      const all = doctorAllOk(checks);
      return [`csagent doctor (${all ? "pass" : "fail"})`, ...lines].join("\n");
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
          return ["csagent memory:", ...head].join("\n") + tail;
        }
        const hits = await store.searchNotes(q, 10);
        if (hits.length === 0) return `Нет совпадений по «${q}».`;
        return [
          `csagent memory search: «${q}»`,
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
        return [`csagent sessions:`, ...lines, cur].join("\n");
      } finally {
        await store.close();
      }
    }

    case "skills": {
      const configured = ctx.skills.length ? ctx.skills : ctx.cfg.skills;
      if (configured.length) {
        return `csagent skills (gateway): ${configured.join(", ")}`;
      }
      const cfg = loadConfig(ctx.dir);
      const all = listSkills(ctx.dir, cfg.skillsPath).slice(0, 12);
      if (all.length === 0) return "Нет skills в каталоге skills/.";
      return ["csagent skills:", ...all.map((s) => `• ${s.name}: ${s.description.slice(0, 60)}`)].join(
        "\n"
      );
    }

    case "approve": {
      if (!p.arg) return "Использование: /approve <код>";
      const out = tryApprovePairing(ctx.dir, ctx.chatId, p.arg);
      return out.message;
    }

    default:
      return null;
  }
}
