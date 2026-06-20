/**
 * `csagent auth` — store secrets locally (chmod 600, gitignored .agent/credentials.json).
 */
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import {
  API_KEY_HELP,
  TELEGRAM_TOKEN_HELP,
  apiKeySourceLabel,
  clearAnthropicApiKey,
  clearClaudeOAuthToken,
  resolveAnthropicKey,
  resolveClaudeOAuthToken,
  saveAnthropicApiKey,
  saveClaudeOAuthToken,
  clearAllStoredCredentials,
  clearStoredTelegramToken,
  credentialsPath,
  hasStoredCredentials,
  hasStoredTelegramToken,
  persistCursorApiKey,
  persistTelegramBotToken,
  pgSecretsEnabled,
  resolveApiKey,
  resolveTelegramBotToken,
  saveCredentials,
  saveTelegramBotToken,
  telegramTokenSourceLabel,
  validateCursorApiKeyFormat,
  validateTelegramBotTokenFormat,
  warmCredentialsCache,
} from "./credentials.js";
import { listPgCredentialHistory, readPgCredentialHistoryValue } from "./credentialsPg.js";
import type { CredentialSecretName } from "./credentialsPg.js";
import { EXIT, type ExitCode } from "./exit.js";

const AUTH_HELP = `csagent auth — local secrets storage (.agent/credentials.json or postgres pgcrypto)

Usage:
  csagent auth login --stdin              Cursor API key (stdin or prompt)
  csagent auth login --from-env           copy CURSOR_API_KEY from environment to file
  csagent auth anthropic login --stdin    Anthropic API key (claude-agent engine, auth=api-key)
  csagent auth anthropic logout           remove stored Anthropic API key
  csagent auth claude token --stdin       Claude OAuth token from \`claude setup-token\` (auth=account)
  csagent auth claude logout              remove stored Claude OAuth token
  csagent auth telegram login --stdin     Telegram bot token
  csagent auth telegram login --from-env  copy TELEGRAM_BOT_TOKEN from environment
  csagent auth logout                     remove stored secrets
  csagent auth telegram logout            remove telegram token only
  csagent auth status                     key + telegram configured? (never prints secrets)
  csagent auth history                    archived secret versions in postgres (no values)
  csagent auth restore <id>               restore an archived version by history id

Environment overrides stored secrets for both CURSOR_API_KEY and TELEGRAM_BOT_TOKEN.
With CSAGENT_DATABASE_URL + CSAGENT_SECRETS_KEY, secrets are encrypted in Postgres (pgcrypto).
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

/** Read a secret from --from-env / --stdin / inline arg. */
async function readSecretArg(
  rest: string[],
  envName: string,
  label: string
): Promise<{ value: string } | { error: ExitCode }> {
  const fromEnv = rest.includes("--from-env");
  const useStdin = rest.includes("--stdin") || (!fromEnv && rest.length === 0);
  const inline = rest.find((a) => !a.startsWith("--"));
  let value = "";
  if (fromEnv) {
    value = (process.env[envName] ?? "").trim();
    if (!value) {
      console.error(`${label}: ${envName} is not set in the environment`);
      return { error: EXIT.config };
    }
  } else if (useStdin && !inline) {
    value = input.isTTY ? await promptLine(`${label}: `) : await readStdinLine();
  } else if (inline) {
    value = inline.trim();
  } else {
    console.error(`${label}: provide --stdin, --from-env, or a value argument`);
    return { error: EXIT.usage };
  }
  if (!value) {
    console.error(`${label}: empty value`);
    return { error: EXIT.usage };
  }
  return { value };
}

/** `csagent auth anthropic …` — Anthropic API key for the claude-agent engine (auth=api-key). */
async function cmdAuthAnthropic(args: string[], dir: string): Promise<ExitCode> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "login": {
      const r = await readSecretArg(rest, "ANTHROPIC_API_KEY", "auth anthropic login");
      if ("error" in r) return r.error;
      saveAnthropicApiKey(r.value, dir);
      console.log(`auth: anthropic API key saved to ${credentialsPath(dir)} (mode 600)`);
      return EXIT.ok;
    }
    case "logout":
      console.log(
        clearAnthropicApiKey(dir) ? "auth: anthropic API key removed" : "auth: no stored anthropic API key"
      );
      return EXIT.ok;
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(AUTH_HELP);
      return EXIT.ok;
    default:
      console.error(`auth anthropic: unknown subcommand '${sub}'\n\n${AUTH_HELP}`);
      return EXIT.usage;
  }
}

/** `csagent auth claude …` — Claude account OAuth token for the claude-agent engine (auth=account). */
async function cmdAuthClaude(args: string[], dir: string): Promise<ExitCode> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "token": {
      const r = await readSecretArg(rest, "CLAUDE_CODE_OAUTH_TOKEN", "auth claude token");
      if ("error" in r) return r.error;
      saveClaudeOAuthToken(r.value, dir);
      console.log(`auth: claude OAuth token saved to ${credentialsPath(dir)} (mode 600)`);
      return EXIT.ok;
    }
    case "logout":
      console.log(
        clearClaudeOAuthToken(dir) ? "auth: claude OAuth token removed" : "auth: no stored claude OAuth token"
      );
      return EXIT.ok;
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(
        "To connect your Claude account: run `claude setup-token` then `csagent auth claude token --stdin`,\n" +
          "or run `claude login` (the Agent SDK reads the keychain / ~/.claude/.credentials.json).\n\n" +
          AUTH_HELP
      );
      return EXIT.ok;
    default:
      console.error(`auth claude: unknown subcommand '${sub}'\n\n${AUTH_HELP}`);
      return EXIT.usage;
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

      if (pgSecretsEnabled()) await persistTelegramBotToken(token, dir);
      else saveTelegramBotToken(token, dir);
      console.log(
        pgSecretsEnabled()
          ? "auth: telegram token saved (postgres credential_secrets, pgcrypto)"
          : `auth: telegram token saved to ${credentialsPath(dir)} (mode 600)`
      );
      return EXIT.ok;
    }
    case "logout": {
      if (await clearStoredTelegramToken(dir)) {
        console.log("auth: telegram token removed");
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
  if (args[0] === "anthropic") {
    return cmdAuthAnthropic(args.slice(1), dir);
  }
  if (args[0] === "claude") {
    return cmdAuthClaude(args.slice(1), dir);
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

      if (pgSecretsEnabled()) await persistCursorApiKey(key, dir);
      else saveCredentials(key, dir);
      console.log(
        pgSecretsEnabled()
          ? "auth: cursor API key saved (postgres credential_secrets, pgcrypto)"
          : `auth: saved to ${credentialsPath(dir)} (mode 600)`
      );
      return EXIT.ok;
    }
    case "logout": {
      if (await clearAllStoredCredentials(dir)) {
        console.log("auth: credentials removed");
      } else {
        console.log("auth: no stored credentials");
      }
      return EXIT.ok;
    }
    case "status": {
      await warmCredentialsCache(dir);
      const api = resolveApiKey(dir);
      const tg = resolveTelegramBotToken(dir);
      console.log(
        `auth: CURSOR_API_KEY — ${api.source === "none" ? "not configured" : apiKeySourceLabel(api.source, dir)}`
      );
      console.log(`auth: TELEGRAM_BOT_TOKEN — ${telegramTokenSourceLabel(tg.source, dir)}`);
      const ant = resolveAnthropicKey(dir);
      const oauth = resolveClaudeOAuthToken(dir);
      console.log(
        `auth: ANTHROPIC_API_KEY — ${ant.source === "none" ? "not configured" : `set (${ant.source})`} [claude-agent engine, auth=api-key]`
      );
      console.log(
        `auth: CLAUDE_CODE_OAUTH_TOKEN — ${oauth.source === "none" ? "not configured (account mode may still use a `claude login` session)" : `set (${oauth.source})`} [claude-agent engine, auth=account]`
      );
      if (hasStoredCredentials(dir) && !pgSecretsEnabled()) {
        console.log(`auth: file ${credentialsPath(dir)}`);
      }
      if ((api.source === "file" || api.source === "pg") && (process.env.CURSOR_API_KEY ?? "").trim()) {
        console.log("auth: note — environment CURSOR_API_KEY overrides stored secret at runtime");
      }
      if ((tg.source === "file" || tg.source === "pg") && (process.env.TELEGRAM_BOT_TOKEN ?? "").trim()) {
        console.log("auth: note — environment TELEGRAM_BOT_TOKEN overrides stored secret at runtime");
      }
      if (api.source === "none" && tg.source === "none") {
        console.log(API_KEY_HELP);
        return EXIT.config;
      }
      return EXIT.ok;
    }
    case "history": {
      if (!pgSecretsEnabled()) {
        console.error("auth history: requires CSAGENT_DATABASE_URL + CSAGENT_SECRETS_KEY (postgres store)");
        return EXIT.config;
      }
      const entries = await listPgCredentialHistory(validateSecretFormat);
      if (entries.length === 0) {
        console.log("auth: no archived secret versions");
        return EXIT.ok;
      }
      console.log("ID    NAME                 REPLACED AT            LEN  FORMAT");
      for (const e of entries) {
        console.log(
          `${String(e.id).padEnd(5)} ${e.name.padEnd(20)} ${e.replaced_at.slice(0, 19).replace("T", " ")}  ${String(e.valueLength).padEnd(4)} ${e.formatOk ? "ok" : "INVALID"}`
        );
      }
      console.log("\nRestore a valid version: csagent auth restore <id>");
      return EXIT.ok;
    }
    case "restore": {
      if (!pgSecretsEnabled()) {
        console.error("auth restore: requires CSAGENT_DATABASE_URL + CSAGENT_SECRETS_KEY (postgres store)");
        return EXIT.config;
      }
      const id = Number(rest[0]);
      if (!Number.isInteger(id) || id <= 0) {
        console.error("auth restore: usage — csagent auth restore <history-id> (see auth history)");
        return EXIT.usage;
      }
      const entry = await readPgCredentialHistoryValue(id);
      if (!entry) {
        console.error(`auth restore: history id ${id} not found`);
        return EXIT.usage;
      }
      // persistSecret re-validates format and archives the current value first.
      if (entry.name === "cursor_api_key") await persistCursorApiKey(entry.value, dir);
      else await persistTelegramBotToken(entry.value, dir);
      console.log(`auth: restored ${entry.name} from history #${id} (previous value archived)`);
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

function validateSecretFormat(name: CredentialSecretName, value: string): boolean {
  return name === "cursor_api_key"
    ? validateCursorApiKeyFormat(value).ok
    : validateTelegramBotTokenFormat(value).ok;
}
