#!/usr/bin/env node
/**
 * cursor-agent — local-first personal agent on the Cursor SDK.
 * P0 commands (issue 001): doctor, run, chat, sessions, resume, config.
 * Implemented in this slice: doctor, run, config. The rest stub out cleanly.
 */
import { cmdDoctor } from "./doctor.js";
import { cmdRun } from "./run.js";
import { cmdChat } from "./chat.js";
import { cmdSessions } from "./sessions_cmd.js";
import { cmdResume } from "./resume.js";
import { loadConfig, ConfigError } from "./config.js";
import { EXIT } from "./exit.js";

const HELP = `cursor-agent — local Cursor SDK agent

Usage:
  cursor-agent doctor              environment checks
  cursor-agent run "<prompt>"      one-shot local task (Agent.prompt, local cwd)
  cursor-agent chat                interactive multi-turn session (Agent.create)
  cursor-agent sessions            list stored sessions
  cursor-agent resume <id> "<p>"   continue a stored session (Agent.resume)
  cursor-agent config              print non-secret config

Secrets: set CURSOR_API_KEY in the environment (never in config).
`;

/** Pull repeatable `--skill <name>` flags out of args; return the rest. */
function extractSkills(args: string[]): { skills: string[]; rest: string[] } {
  const skills: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skill" && i + 1 < args.length) {
      skills.push(args[++i]);
    } else {
      rest.push(args[i]);
    }
  }
  return { skills, rest };
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "doctor":
      return cmdDoctor();
    case "run": {
      const { skills, rest: r } = extractSkills(rest);
      return cmdRun(r.join(" "), { skills });
    }
    case "chat": {
      const { skills } = extractSkills(rest);
      return cmdChat({ skills });
    }
    case "sessions":
      return cmdSessions();
    case "resume": {
      const { rest: r } = extractSkills(rest);
      const [sid, ...p] = r;
      return cmdResume(sid ?? "", p.join(" "));
    }
    case "config": {
      try {
        console.log(JSON.stringify(loadConfig(), null, 2));
        return EXIT.ok;
      } catch (e) {
        console.error("config: " + (e instanceof ConfigError ? e.message : String(e)));
        return EXIT.startup;
      }
    }
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(HELP);
      return EXIT.ok;
    default:
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      return EXIT.startup;
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("fatal: " + (e?.message ?? String(e)));
    process.exit(1);
  });
