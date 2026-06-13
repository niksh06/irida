#!/usr/bin/env node
/**
 * cursor-agent — local-first personal agent on the Cursor SDK.
 * P0 commands (issue 001): doctor, run, chat, sessions, resume, config — all
 * implemented. See docs/reviews/mvp-p0-review.md for status and limitations.
 */
import { loadCsagentEnv } from "./loadEnv.js";
import { warmCredentialsCache } from "./credentials.js";
loadCsagentEnv();

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
import { loadConfig, ConfigError } from "./config.js";
import { EXIT } from "./exit.js";

const HELP = `csagent — local Cursor SDK agent

Usage:
  csagent doctor              environment checks
  csagent doctor morning-alert   cron jobs health + Telegram alert on FAIL (launchd 08:05)
  csagent run "<prompt>"      one-shot local task (Agent.prompt, local cwd)
  csagent chat                interactive multi-turn session (Agent.create)
  csagent tui                 Hermes-style Ink TUI for chat
  csagent sessions            list stored sessions
  csagent sessions search <q> filter by id/title/cwd
  csagent store migrate       copy sqlite sessions/runs → postgres (CSAGENT_DATABASE_URL)
  csagent resume <id> "<p>"   continue a stored session (Agent.resume)
  csagent config              print non-secret config
  csagent auth login --stdin  save API key to .agent/credentials.json (600)
  csagent auth telegram login --stdin  save Telegram bot token to credentials.json
  csagent auth status         keys configured? (never prints secrets)
  csagent memory list         durable notes (.agent/memory/)
  csagent cron list           scheduled jobs (.agent/cron.jobs.json)
  csagent gateway run         messaging bridge (webhook → chat)
  csagent skills list         list local Markdown skills
  csagent skills search <q>   search skills by name/description/tags

Note: bare \`cursor-agent\` in PATH is Cursor's official CLI (different tool).
Use \`csagent\`, \`npm run doctor\`, or \`npm run dev -- …\` for this project.

Secrets: \`csagent auth login --stdin\` (local file) or CURSOR_API_KEY in the environment (CI override). Never in agent.config.json.
`;

/** Pull `--skill <name>` (repeatable) and `--yes-i-understand` flags; return the rest. */
function extractFlags(args: string[]): { skills: string[]; yes: boolean; rest: string[] } {
  const skills: string[] = [];
  const rest: string[] = [];
  let yes = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skill" && i + 1 < args.length) skills.push(args[++i]);
    else if (args[i] === "--yes-i-understand") yes = true;
    else rest.push(args[i]);
  }
  return { skills, yes, rest };
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
      const { skills, yes, rest: r } = extractFlags(rest);
      return cmdRun(r.join(" "), { skills, yesIUnderstand: yes });
    }
    case "chat": {
      const { skills, yes } = extractFlags(rest);
      return cmdChat({ skills, yesIUnderstand: yes });
    }
    case "tui": {
      const { skills, yes } = extractFlags(rest);
      return cmdTui({ skills, yesIUnderstand: yes });
    }
    case "sessions":
      return cmdSessions(rest);
    case "store":
      return cmdStore(rest);
    case "skills":
      return cmdSkills(rest);
    case "resume": {
      const { yes, rest: r } = extractFlags(rest);
      const [sid, ...p] = r;
      return cmdResume(sid ?? "", p.join(" "), { yesIUnderstand: yes });
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
    case "gateway":
      return cmdGateway(rest);
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
