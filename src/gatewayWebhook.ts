/**
 * Webhook HTTP adapter for the messaging gateway (issue 037).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  type GatewayConfig,
  gatewayWebhookSecret,
  isChatAllowed,
} from "./gatewayConfig.js";
import { GatewaySessionRouter } from "./gatewayRouter.js";

export interface WebhookRequestBody {
  chatId: string;
  text: string;
}

export interface WebhookHandleResult {
  status: number;
  body: Record<string, unknown>;
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

export function parseWebhookBody(raw: string): WebhookRequestBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON body");
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("body must be a JSON object");
  }
  const o = parsed as Record<string, unknown>;
  const chatId = typeof o.chatId === "string" ? o.chatId.trim() : "";
  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (!chatId) throw new Error("chatId is required");
  if (!text) throw new Error("text is required");
  return { chatId, text };
}

export function webhookAuthOk(req: IncomingMessage, secret: string): boolean {
  if (!secret) return false;
  const header = req.headers["x-gateway-secret"];
  if (typeof header === "string" && header === secret) return true;
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth === `Bearer ${secret}`) return true;
  return false;
}

export async function handleWebhookHttp(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: GatewayConfig,
  router: GatewaySessionRouter
): Promise<void> {
  const secret = gatewayWebhookSecret(cfg);
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  if (!webhookAuthOk(req, secret)) {
    json(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  let raw: string;
  try {
    raw = await readBody(req, cfg.maxMessageLength + 4096);
  } catch {
    json(res, 413, { ok: false, error: "body too large" });
    return;
  }
  let body: WebhookRequestBody;
  try {
    body = parseWebhookBody(raw);
  } catch (e) {
    json(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) });
    return;
  }
  if (!isChatAllowed(cfg, body.chatId)) {
    json(res, 403, { ok: false, error: "chatId not allowed" });
    return;
  }
  if (body.text.length > cfg.maxMessageLength) {
    json(res, 400, { ok: false, error: "text too long" });
    return;
  }
  if (router.isBusy(body.chatId)) {
    json(res, 429, { ok: false, error: "busy" });
    return;
  }
  try {
    const { reply } = await router.handleInbound(body.chatId, body.text);
    json(res, 200, { ok: true, reply });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    json(res, 500, { ok: false, error: message });
  }
}

export interface WebhookServer {
  server: Server;
  close(): Promise<void>;
}

export function startWebhookServer(
  cfg: GatewayConfig,
  router: GatewaySessionRouter
): WebhookServer {
  const server = createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "";
    if (path !== cfg.webhookPath) {
      json(res, 404, { ok: false, error: "not found" });
      return;
    }
    void handleWebhookHttp(req, res, cfg, router);
  });
  return {
    server,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** Test helper: handle one request without binding a port. */
export async function dispatchWebhookRequest(
  cfg: GatewayConfig,
  router: GatewaySessionRouter,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<WebhookHandleResult> {
  const secret = gatewayWebhookSecret(cfg);
  const headers = { ...init.headers };
  if (secret && !headers["x-gateway-secret"] && !headers.authorization) {
    headers["x-gateway-secret"] = secret;
  }
  return new Promise((resolve, reject) => {
    const req = {
      method: init.method ?? "POST",
      headers,
      url: cfg.webhookPath,
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === "data" && init.body != null) cb(Buffer.from(init.body, "utf8"));
        if (event === "end") queueMicrotask(() => cb());
      },
      destroy() {},
    } as unknown as IncomingMessage;

    const state = { statusCode: 200, headers: {} as Record<string, string> };
    const res = {
      writeHead(status: number, h: Record<string, string>) {
        state.statusCode = status;
        state.headers = h;
      },
      end(payload: string) {
        try {
          resolve({ status: state.statusCode, body: JSON.parse(payload) as Record<string, unknown> });
        } catch {
          resolve({ status: state.statusCode, body: { raw: payload } });
        }
      },
    } as unknown as ServerResponse;

    void handleWebhookHttp(req, res, cfg, router).catch(reject);
  });
}
