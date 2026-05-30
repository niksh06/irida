/**
 * `csagent gateway run` — long-running messaging bridge (issue 037).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { API_KEY_HELP, resolveApiKey } from "./credentials.js";
import { EXIT, type ExitCode } from "./exit.js";
import {
  GATEWAY_FILE,
  GatewayConfigError,
  loadGatewayConfig,
  type GatewayConfig,
} from "./gatewayConfig.js";
import { GatewaySessionRouter } from "./gatewayRouter.js";
import { startWebhookServer, type WebhookServer } from "./gatewayWebhook.js";
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
  close(): Promise<void>;
}

function applyCliOverrides(cfg: GatewayConfig, opts: GatewayRunOptions): GatewayConfig {
  const next = { ...cfg };
  if (opts.adapter === "webhook" || opts.adapter === "telegram") next.adapter = opts.adapter;
  if (typeof opts.port === "number" && opts.port > 0) next.port = opts.port;
  return next;
}

export async function startGateway(opts: GatewayRunOptions = {}): Promise<GatewayRunHandle> {
  const dir = opts.dir ?? process.cwd();
  const { key: apiKey } = resolveApiKey(dir);
  if (!apiKey) throw new GatewayConfigError(API_KEY_HELP);

  let cfg = loadGatewayConfig(dir);
  cfg = applyCliOverrides(cfg, opts);

  if (cfg.adapter === "telegram") {
    throw new GatewayConfigError("telegram adapter is not implemented yet — use webhook");
  }
  if (cfg.allowedChatIds.length === 0) {
    throw new GatewayConfigError("allowedChatIds is empty — configure peers in gateway.json");
  }

  const router = new GatewaySessionRouter({
    dir,
    adapter: cfg.adapter,
    skills: cfg.skills,
    yesIUnderstand: cfg.yesIUnderstand,
    sdk: opts.sdk,
  });

  const webhook = startWebhookServer(cfg, router);
  await new Promise<void>((resolve, reject) => {
    webhook.server.once("error", reject);
    webhook.server.listen(cfg.port, cfg.host, () => resolve());
  });
  console.error(`[gateway] webhook listening http://${cfg.host}:${cfg.port}${cfg.webhookPath}`);

  return {
    cfg,
    router,
    webhook,
    close: async () => {
      await router.closeAll();
      if (webhook) await webhook.close();
    },
  };
}

export async function cmdGatewayRun(opts: GatewayRunOptions = {}): Promise<ExitCode> {
  let handle: GatewayRunHandle | undefined;
  try {
    handle = await startGateway(opts);
  } catch (e) {
    console.error("gateway: " + (e instanceof GatewayConfigError ? e.message : String(e)));
    return EXIT.config;
  }

  const shutdown = async (signal: string) => {
    console.error(`[gateway] ${signal} — shutting down`);
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

export async function cmdGateway(argv: string[], opts: GatewayRunOptions = {}): Promise<ExitCode> {
  const [sub, ...rest] = argv;
  switch (sub) {
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
  csagent gateway run [--adapter webhook] [--port 18789]

Config: .agent/gateway.json
Secret: env GATEWAY_WEBHOOK_SECRET (or webhook.secretEnv in config)

Example gateway.json:
{
  "version": 1,
  "adapter": "webhook",
  "listen": { "host": "127.0.0.1", "port": 18789 },
  "webhook": { "path": "/hook", "secretEnv": "GATEWAY_WEBHOOK_SECRET" },
  "allowedChatIds": ["u1"],
  "maxMessageLength": 8000,
  "skills": []
}

Webhook request:
  POST /hook
  Header: X-Gateway-Secret: <secret>  (or Authorization: Bearer <secret>)
  Body: { "chatId": "u1", "text": "hello" }
`);
      return EXIT.ok;
    default:
      console.error(`gateway: unknown subcommand '${sub}'\n\nRun: csagent gateway help`);
      return EXIT.usage;
  }
}

/** Write example config (tests). */
export function writeExampleGatewayConfig(dir: string, partial: Partial<GatewayConfig> = {}): GatewayConfig {
  const cfg = loadConfig(dir);
  const root = resolve(dir, cfg.stateDir);
  mkdirSync(root, { recursive: true });
  const example: GatewayConfig = {
    version: 1,
    adapter: "webhook",
    host: "127.0.0.1",
    port: partial.port ?? 18789,
    webhookPath: "/hook",
    secretEnv: "GATEWAY_WEBHOOK_SECRET",
    allowedChatIds: ["u1"],
    maxMessageLength: 8000,
    skills: [],
    ...partial,
  };
  writeFileSync(
    resolve(root, GATEWAY_FILE),
    JSON.stringify(
      {
        version: 1,
        adapter: example.adapter,
        listen: { host: example.host, port: example.port },
        webhook: { path: example.webhookPath, secretEnv: example.secretEnv },
        allowedChatIds: example.allowedChatIds,
        maxMessageLength: example.maxMessageLength,
        skills: example.skills,
      },
      null,
      2
    ) + "\n",
    { encoding: "utf8", mode: 0o600 }
  );
  return example;
}
