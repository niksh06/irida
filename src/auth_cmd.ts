/**
 * `csagent auth` — store secrets locally (chmod 600, gitignored .agent/credentials.json).
 */
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import {
  API_KEY_HELP,
  TELEGRAM_TOKEN_HELP,
  clearCredentials,
  clearTelegramBotToken,
  credentialsPath,
  hasStoredCredentials,
  hasStoredTelegramToken,
  resolveApiKey,
  resolveTelegramBotToken,
  saveCredentials,
  saveTelegramBotToken,
  telegramTokenSourceLabel,
} from "./credentials.js";
import { EXIT, type ExitCode } from "./exit.js";

const AUTH_HELP = `csagent auth — local secrets storage (.agent/credentials.json, mode 600)

Usage:
  csagent auth login --stdin              Cursor API key (stdin or prompt)
  csagent auth login --from-env           copy CURSOR_API_KEY from environment to file
  csagent auth telegram login --stdin     Telegram bot token
  csagent auth telegram login --from-env  copy TELEGRAM_BOT_TOKEN from environment
  csagent auth logout                     remove entire credentials file
  csagent auth telegram logout            remove telegram token only
  csagent auth status                     key + telegram configured? (never prints secrets)

Environment overrides file for both CURSOR_API_KEY and TELEGRAM_BOT_TOKEN.
`;

async function readStdinLine(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    input.setEncoding("utf8");
    input.on("data", (chunk) => {
      data += chunk;
    });
    input.on("end", () => resolve(data.trim()));
    input.on("error", reject);
    if (input.isPaused()) input.resume();
  });
}

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return await new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer.trim()));
    });
  } finally {
    rl.close();
  }
}

async function cmdAuthTelegram(args: string[], dir: string): Promise<ExitCode> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "login": {
      const fromEnv = rest.includes("--from-env");
      const useStdin = rest.includes("--stdin") || (!fromEnv && rest.length === 0);
      const inline = rest.find((a) => !a.startsWith("--"));

      let token = "";
      if (fromEnv) {
        token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
        if (!token) {
          console.error("auth telegram login: TELEGRAM_BOT_TOKEN is not set in the environment");
          return EXIT.config;
        }
      } else if (useStdin && !inline) {
        if (input.isTTY) {
          token = await promptLine("Telegram bot token: ");
        } else {
          token = await readStdinLine();
        }
      } else if (inline) {
        token = inline.trim();
      } else {
        console.error("auth telegram login: provide --stdin, --from-env, or a token argument");
        console.error(TELEGRAM_TOKEN_HELP);
        return EXIT.usage;
      }

      if (!token) {
        console.error("auth telegram login: empty token");
        return EXIT.usage;
      }

      saveTelegramBotToken(token, dir);
      console.log(`auth: telegram token saved to ${credentialsPath(dir)} (mode 600)`);
      return EXIT.ok;
    }
    case "logout": {
      if (clearTelegramBotToken(dir)) {
        console.log("auth: telegram token removed from credentials file");
      } else {
        console.log("auth: no stored telegram token");
      }
      return EXIT.ok;
    }
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(AUTH_HELP);
      return EXIT.ok;
    default:
      console.error(`auth telegram: unknown subcommand '${sub}'\n\n${AUTH_HELP}`);
      return EXIT.usage;
  }
}

export async function cmdAuth(args: string[], dir: string = process.cwd()): Promise<ExitCode> {
  if (args[0] === "telegram") {
    return cmdAuthTelegram(args.slice(1), dir);
  }
  const [sub, ...rest] = args;
  switch (sub) {
    case "login": {
      const fromEnv = rest.includes("--from-env");
      const useStdin = rest.includes("--stdin") || (!fromEnv && rest.length === 0);
      const inline = rest.find((a) => !a.startsWith("--"));

      let key = "";
      if (fromEnv) {
        key = (process.env.CURSOR_API_KEY ?? "").trim();
        if (!key) {
          console.error("auth login: CURSOR_API_KEY is not set in the environment");
          return EXIT.config;
        }
      } else if (useStdin && !inline) {
        if (input.isTTY) {
          key = await promptLine("Cursor API key: ");
        } else {
          key = await readStdinLine();
        }
      } else if (inline) {
        key = inline.trim();
      } else {
        console.error("auth login: provide --stdin, --from-env, or a key argument");
        console.error(API_KEY_HELP);
        return EXIT.usage;
      }

      if (!key) {
        console.error("auth login: empty API key");
        return EXIT.usage;
      }

      saveCredentials(key, dir);
      console.log(`auth: saved to ${credentialsPath(dir)} (mode 600)`);
      return EXIT.ok;
    }
    case "logout": {
      if (clearCredentials(dir)) {
        console.log("auth: credentials removed");
      } else {
        console.log("auth: no stored credentials");
      }
      return EXIT.ok;
    }
    case "status": {
      const api = resolveApiKey(dir);
      const tg = resolveTelegramBotToken(dir);
      console.log(`auth: CURSOR_API_KEY — ${api.source === "none" ? "not configured" : api.source === "env" ? "environment" : "local file"}`);
      console.log(`auth: TELEGRAM_BOT_TOKEN — ${telegramTokenSourceLabel(tg.source, dir)}`);
      if (hasStoredCredentials(dir)) console.log(`auth: file ${credentialsPath(dir)}`);
      if (api.source === "file" && (process.env.CURSOR_API_KEY ?? "").trim()) {
        console.log("auth: note — environment CURSOR_API_KEY overrides file at runtime");
      }
      if (tg.source === "file" && (process.env.TELEGRAM_BOT_TOKEN ?? "").trim()) {
        console.log("auth: note — environment TELEGRAM_BOT_TOKEN overrides file at runtime");
      }
      if (api.source === "none" && tg.source === "none") {
        console.log(API_KEY_HELP);
        return EXIT.config;
      }
      return EXIT.ok;
    }
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(AUTH_HELP);
      return EXIT.ok;
    default:
      console.error(`auth: unknown subcommand '${sub}'\n\n${AUTH_HELP}`);
      return EXIT.usage;
  }
}
