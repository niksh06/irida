/**
 * `irida gateway run` — long-running messaging bridge (issue 037).
 */
import { resolve } from "node:path";
import { iridaHome } from "./env.js";
import { loadConfig } from "./config.js";
import { API_KEY_HELP, resolveApiKey, warmCredentialsCache } from "./credentials.js";
import { EXIT, type ExitCode } from "./exit.js";
import {
  GatewayConfigError,
  loadGatewayConfig,
  type GatewayConfig,
} from "./gatewayConfig.js";
import { GatewaySessionRouter } from "./gatewayRouter.js";
import { startWebhookServer, type WebhookServer } from "./gatewayWebhook.js";
import { startTelegramPoller, type TelegramPoller } from "./gatewayTelegram.js";
import { gatherGatewayStatus, gatherGatewayStoreStatusLines, gatherTelegramGatewayStatusLines } from "./gatewayStatus.js";
import { installGatewayProcessGuards } from "./gatewayProcessGuards.js";
import { emitServiceLog } from "./serviceLog.js";
import { warmGatewayAllowlistCache, resolveAllowedChatIds } from "./gatewayAllowlist.js";
import type { SdkCreateLike, SdkResumeLike } from "./host.js";

export interface GatewayRunOptions {
  dir?: string;
  adapter?: string;
  port?: number;
  sdk?: SdkCreateLike & SdkResumeLike;
}

export interface GatewayRunHandle {
  cfg: GatewayConfig;
  router: GatewaySessionRouter;
  webhook?: WebhookServer;
  telegram?: TelegramPoller;
  close(): Promise<void>;
}

function applyCliOverrides(cfg: GatewayConfig, opts: GatewayRunOptions): GatewayConfig {
  const next = { ...cfg };
  if (opts.adapter === "webhook" || opts.adapter === "telegram") next.adapter = opts.adapter;
  if (typeof opts.port === "number" && opts.port > 0) next.port = opts.port;
  return next;
}

export async function startGateway(opts: GatewayRunOptions = {}): Promise<GatewayRunHandle> {
  const dir = opts.dir ?? iridaHome() ?? process.cwd();
  await warmCredentialsCache(dir);
  await warmGatewayAllowlistCache(dir);
  const { key: apiKey } = resolveApiKey(dir);
  if (!apiKey) throw new GatewayConfigError(API_KEY_HELP);

  let cfg = loadGatewayConfig(dir);
  cfg = applyCliOverrides(cfg, opts);
  cfg = { ...cfg, allowedChatIds: resolveAllowedChatIds(cfg, dir) };

  if (cfg.allowedChatIds.length === 0) {
    throw new GatewayConfigError("allowedChatIds is empty — configure peers in gateway.json or postgres allowlist");
  }

  const router = new GatewaySessionRouter({
    dir,
    adapter: cfg.adapter,
    skills: cfg.skills,
    yesIUnderstand: cfg.yesIUnderstand,
    sdk: opts.sdk,
  });

  if (cfg.adapter === "telegram") {
    const telegram = startTelegramPoller({ cfg, router, dir });
    return {
      cfg,
      router,
      telegram,
      close: async () => {
        await telegram.stop();
        await router.closeAll();
      },
    };
  }

  const webhook = startWebhookServer(cfg, router, dir);
  await new Promise<void>((resolve, reject) => {
    webhook.server.once("error", reject);
    webhook.server.listen(cfg.port, cfg.host, () => resolve());
  });
  emitServiceLog(`[gateway] webhook listening http://${cfg.host}:${cfg.port}${cfg.webhookPath}`, "info");

  return {
    cfg,
    router,
    webhook,
    close: async () => {
      await router.closeAll();
      await webhook.close();
    },
  };
}

export async function cmdGatewayRun(opts: GatewayRunOptions = {}): Promise<ExitCode> {
  installGatewayProcessGuards();
  let handle: GatewayRunHandle | undefined;
  try {
    handle = await startGateway(opts);
  } catch (e) {
    console.error("gateway: " + (e instanceof GatewayConfigError ? e.message : String(e)));
    return EXIT.config;
  }

  const shutdown = async (signal: string) => {
    emitServiceLog(`[gateway] ${signal} — shutting down`, "info");
    try {
      await handle!.close();
    } finally {
      process.exit(EXIT.ok);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  return new Promise(() => {
    /* block until signal */
  });
}

export async function cmdGatewayStatus(opts: GatewayRunOptions = {}): Promise<ExitCode> {
  const dir = opts.dir ?? iridaHome() ?? process.cwd();
  await warmCredentialsCache(dir);
  await warmGatewayAllowlistCache(dir);
  const rows = [
    ...gatherGatewayStatus(dir),
    ...(await gatherGatewayStoreStatusLines()),
    ...(await gatherTelegramGatewayStatusLines(dir)),
  ];
  let ok = true;
  for (const r of rows) {
    const mark = r.ok ? "ok" : "FAIL";
    if (!r.ok) ok = false;
    console.log(`${mark.padEnd(5)} ${r.name.padEnd(18)} ${r.detail}`);
  }
  return ok ? EXIT.ok : EXIT.config;
}

export async function cmdGateway(argv: string[], opts: GatewayRunOptions = {}): Promise<ExitCode> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "status":
      return await cmdGatewayStatus(opts);
    case "run": {
      let adapter: string | undefined;
      let port: number | undefined;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--adapter" && i + 1 < rest.length) adapter = rest[++i];
        else if (rest[i] === "--port" && i + 1 < rest.length) port = Number(rest[++i]);
      }
      return cmdGatewayRun({ ...opts, adapter, port });
    }
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(`Usage:
  irida gateway status          launchd + log probe (no server start)
  irida gateway run [--adapter webhook|telegram] [--port 18789]

Config: .agent/gateway.json
Webhook secret: env GATEWAY_WEBHOOK_SECRET
Telegram token: irida auth telegram login --stdin (or env TELEGRAM_BOT_TOKEN)

Example gateway.json (webhook):
{
  "version": 1,
  "adapter": "webhook",
  "listen": { "host": "127.0.0.1", "port": 18789 },
  "webhook": { "path": "/hook", "secretEnv": "GATEWAY_WEBHOOK_SECRET" },
  "allowedChatIds": ["u1"],
  "maxMessageLength": 8000
}

Example gateway.json (telegram):
{
  "version": 1,
  "adapter": "telegram",
  "telegram": { "tokenEnv": "TELEGRAM_BOT_TOKEN", "pollIntervalMs": 1500 },
  "allowedChatIds": ["123456789"],
  "maxMessageLength": 8000
}

Group/channel auth: a negative chat id is a group/supergroup/channel where
the chat allowlist alone does not identify the actor. For a GROUP, also set
telegram.allowedSenderIds: ["<your user id>"] — other members are ignored.
For a CHANNEL, set telegram.allowChannelPosts: true (admins-only; no per-user
sender). Private 1:1 chats need neither.

Webhook request:
  POST /hook
  Header: X-Gateway-Secret: <secret>
  Body: { "chatId": "u1", "text": "hello" }
`);
      return EXIT.ok;
    default:
      console.error(`gateway: unknown subcommand '${sub}'\n\nRun: irida gateway help`);
      return EXIT.usage;
  }
}

