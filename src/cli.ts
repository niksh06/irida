#!/usr/bin/env node
/**
 * irida — local-first personal agent on the Cursor SDK.
 * P0 commands (issue 001): doctor, run, chat, sessions, resume, config — all
 * implemented. See docs/reviews/mvp-p0-review.md for status and limitations.
 */
import { loadIridaEnv } from "./loadEnv.js";
import { warmCredentialsCache } from "./credentials.js";
loadIridaEnv();

import { cmdDoctor, cmdDoctorMorningAlert } from "./doctor.js";
import { cmdRun } from "./run.js";
import { cmdChat } from "./chat.js";
import { cmdSessions } from "./sessions_cmd.js";
import { cmdResume } from "./resume.js";
import { cmdSkills } from "./skills_cmd.js";
import { cmdTui } from "./tui_cmd.js";
import { cmdAuth } from "./auth_cmd.js";
import { cmdMemory } from "./memory_cmd.js";
import { cmdCron } from "./cron_cmd.js";
import { cmdGateway } from "./gateway_cmd.js";
import { cmdStore } from "./store_cmd.js";
import { cmdEval } from "./eval_cmd.js";
import { cmdPet } from "./pet_cmd.js";
import { cmdBackground } from "./background_cmd.js";
import { loadConfig, ConfigError } from "./config.js";
import { EXIT } from "./exit.js";

const HELP = `irida — local-first personal agent (Cursor SDK + Claude Agent SDK)

Usage:
  irida doctor              environment checks
  irida doctor morning-alert   cron jobs health + Telegram alert on FAIL (launchd 08:05)
  irida run "<prompt>"      one-shot local task (Agent.prompt, local cwd)
  irida chat                interactive multi-turn session (Agent.create)
  irida tui                 Hermes-style Ink TUI for chat
  irida sessions            list stored sessions
  irida sessions search <q> filter by id/title/cwd
  irida store migrate       copy sqlite sessions/runs → postgres (IRIDA_DATABASE_URL)
  irida resume <id> "<p>"   continue a stored session (Agent.resume)
  irida config              print non-secret config
  irida auth login --stdin  save Cursor API key to .agent/credentials.json (600)
  irida auth anthropic login --stdin  Anthropic API key (claude-agent engine)
  irida auth claude token --stdin     Claude account OAuth token (claude-agent, auth=account)
  irida auth telegram login --stdin   save Telegram bot token to credentials.json
  irida auth status         keys configured? (never prints secrets)
  irida memory list         durable notes (.agent/memory/)
  irida cron list           scheduled jobs (.agent/cron.jobs.json)
  irida background pause    pause autonomous cron (only my-side initiation)
  irida gateway run         messaging bridge (webhook → chat)
  irida skills list         list local Markdown skills
  irida skills search <q>   search skills by name/description/tags
  irida pet status          pet snapshot (debug; mascot is in tui)

Engine: pick the runtime per command with --engine cursor|claude-agent and the
  claude-agent auth with --auth api-key|account (overrides agent.config.json).
  e.g.  irida run "..." --engine claude-agent --auth account

Note: \`csagent\` is the deprecated alias for \`irida\`. Bare \`cursor-agent\` in PATH
  is Cursor's official CLI (a different tool).

Secrets: \`irida auth login --stdin\` (local file) or CURSOR_API_KEY in the environment (CI override). Never in agent.config.json.
`;

/** Pull `--skill <name>` (repeatable), `--yes-i-understand`, `--engine <p>`, `--auth <m>`; return the rest. */
function extractFlags(args: string[]): {
  skills: string[];
  yes: boolean;
  engine?: string;
  auth?: string;
  rest: string[];
} {
  const skills: string[] = [];
  const rest: string[] = [];
  let yes = false;
  let engine: string | undefined;
  let auth: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skill" && i + 1 < args.length) skills.push(args[++i]);
    else if (args[i] === "--yes-i-understand") yes = true;
    else if (args[i] === "--engine" && i + 1 < args.length) engine = args[++i];
    else if (args[i] === "--auth" && i + 1 < args.length) auth = args[++i];
    else rest.push(args[i]);
  }
  return { skills, yes, engine, auth, rest };
}

async function main(argv: string[]): Promise<number> {
  await warmCredentialsCache(process.cwd());
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "doctor": {
      const sub = rest[0];
      if (sub === "morning-alert") return await cmdDoctorMorningAlert();
      return await cmdDoctor();
    }
    case "run": {
      const { skills, yes, engine, auth, rest: r } = extractFlags(rest);
      return cmdRun(r.join(" "), { skills, yesIUnderstand: yes, engine, auth });
    }
    case "chat": {
      const { skills, yes, engine, auth } = extractFlags(rest);
      return cmdChat({ skills, yesIUnderstand: yes, engine, auth });
    }
    case "tui": {
      const { skills, yes, engine, auth } = extractFlags(rest);
      return cmdTui({ skills, yesIUnderstand: yes, engine, auth });
    }
    case "sessions":
      return cmdSessions(rest);
    case "store":
      return cmdStore(rest);
    case "skills":
      return cmdSkills(rest);
    case "resume": {
      const { yes, engine, auth, rest: r } = extractFlags(rest);
      const [sid, ...p] = r;
      return cmdResume(sid ?? "", p.join(" "), { yesIUnderstand: yes, engine, auth });
    }
    case "config": {
      try {
        console.log(JSON.stringify(loadConfig(), null, 2));
        return EXIT.ok;
      } catch (e) {
        console.error("config: " + (e instanceof ConfigError ? e.message : String(e)));
        return EXIT.config;
      }
    }
    case "auth":
      return cmdAuth(rest);
    case "memory":
      return cmdMemory(rest);
    case "cron":
      return cmdCron(rest);
    case "background":
    case "bg":
      return cmdBackground(rest);
    case "gateway":
      return await cmdGateway(rest);
    case "eval":
      return cmdEval(rest);
    case "pet":
      return await cmdPet(rest);
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(HELP);
      return EXIT.ok;
    default:
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      return EXIT.usage;
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("fatal: " + (e?.message ?? String(e)));
    process.exit(1);
  });
