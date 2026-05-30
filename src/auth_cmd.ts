/**
 * `csagent auth` — store CURSOR_API_KEY locally (chmod 600, gitignored .agent/).
 */
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import {
  API_KEY_HELP,
  clearCredentials,
  credentialsPath,
  hasStoredCredentials,
  resolveApiKey,
  saveCredentials,
} from "./credentials.js";
import { EXIT, type ExitCode } from "./exit.js";

const AUTH_HELP = `csagent auth — local API key storage

Usage:
  csagent auth login --stdin       read key from stdin (recommended)
  csagent auth login --from-env    copy CURSOR_API_KEY from environment to file
  csagent auth logout              remove stored credentials file
  csagent auth status              show whether a key is configured (never prints the key)

File: .agent/credentials.json (mode 600, gitignored). Environment overrides file.
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

export async function cmdAuth(args: string[], dir: string = process.cwd()): Promise<ExitCode> {
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
      const resolved = resolveApiKey(dir);
      if (resolved.source === "none") {
        console.log("auth: not configured");
        console.log(API_KEY_HELP);
        return EXIT.config;
      }
      const stored = hasStoredCredentials(dir);
      console.log(`auth: configured (${resolved.source === "env" ? "environment" : "local file"})`);
      if (stored) console.log(`auth: file ${credentialsPath(dir)}`);
      if (resolved.source === "file" && (process.env.CURSOR_API_KEY ?? "").trim()) {
        console.log("auth: note — environment CURSOR_API_KEY overrides file at runtime");
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
