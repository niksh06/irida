/**
 * Maps (adapter, chatId) → stable sess_ and reuses open ChatSession handles.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { openChatSession, type ChatSession } from "./chatEngine.js";
import type { SdkCreateLike, SdkResumeLike } from "./host.js";

export const GATEWAY_PEERS_FILE = "gateway.peers.json";

export interface GatewayPeersFile {
  version: number;
  peers: Record<string, string>;
}

export class GatewayRouterError extends Error {}

function peersPath(dir: string): string {
  const cfg = loadConfig(dir);
  return resolve(dir, cfg.stateDir, GATEWAY_PEERS_FILE);
}

export function loadGatewayPeers(dir: string): GatewayPeersFile {
  const path = peersPath(dir);
  if (!existsSync(path)) return { version: 1, peers: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<GatewayPeersFile>;
    return {
      version: 1,
      peers: parsed.peers && typeof parsed.peers === "object" ? { ...parsed.peers } : {},
    };
  } catch {
    return { version: 1, peers: {} };
  }
}

export function saveGatewayPeers(dir: string, data: GatewayPeersFile): void {
  const cfg = loadConfig(dir);
  const root = resolve(dir, cfg.stateDir);
  mkdirSync(root, { recursive: true });
  writeFileSync(peersPath(dir), JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}

export function peerKey(adapter: string, chatId: string): string {
  return `${adapter}:${chatId}`;
}

export interface GatewayRouterOptions {
  dir: string;
  adapter: string;
  skills?: string[];
  yesIUnderstand?: boolean;
  sdk?: SdkCreateLike & SdkResumeLike;
  onLog?: (line: string) => void;
}

export class GatewaySessionRouter {
  private readonly dir: string;
  private readonly adapter: string;
  private readonly skills: string[];
  private readonly yesIUnderstand: boolean;
  private readonly sdk?: SdkCreateLike & SdkResumeLike;
  private readonly onLog: (line: string) => void;
  private peers: GatewayPeersFile;
  private active = new Map<string, ChatSession>();
  private busy = new Set<string>();

  constructor(opts: GatewayRouterOptions) {
    this.dir = opts.dir;
    this.adapter = opts.adapter;
    this.skills = opts.skills ?? [];
    this.yesIUnderstand = opts.yesIUnderstand ?? false;
    this.sdk = opts.sdk;
    this.onLog = opts.onLog ?? ((line) => console.error(line));
    this.peers = loadGatewayPeers(opts.dir);
  }

  isBusy(chatId: string): boolean {
    return this.busy.has(peerKey(this.adapter, chatId));
  }

  /** Drop cached SDK session for a peer; next inbound creates a fresh sess_. */
  async resetPeer(chatId: string): Promise<string | null> {
    const key = peerKey(this.adapter, chatId);
    const previousSessionId = this.peers.peers[key] ?? null;
    const cached = this.active.get(key);
    if (cached) {
      await cached.close();
      this.active.delete(key);
    }
    delete this.peers.peers[key];
    saveGatewayPeers(this.dir, this.peers);
    return previousSessionId;
  }

  async getOrCreateSession(chatId: string): Promise<ChatSession> {
    const key = peerKey(this.adapter, chatId);
    const cached = this.active.get(key);
    if (cached) return cached;

    const resumeId = this.peers.peers[key];
    const opened = await openChatSession({
      dir: this.dir,
      sdk: this.sdk,
      resumeSessionId: resumeId,
      skills: this.skills,
      yesIUnderstand: this.yesIUnderstand,
      interactive: false,
      onLog: this.onLog,
    });
    if (!opened.ok) {
      throw new GatewayRouterError(opened.message);
    }
    this.peers.peers[key] = opened.session.sessionId;
    saveGatewayPeers(this.dir, this.peers);
    this.active.set(key, opened.session);
    return opened.session;
  }

  async handleInbound(chatId: string, text: string): Promise<{ reply: string }> {
    const key = peerKey(this.adapter, chatId);
    if (this.busy.has(key)) {
      throw new GatewayRouterError("peer busy — previous turn still running");
    }
    this.busy.add(key);
    try {
      if (text.trim() === "/new") {
        const previousSessionId = await this.resetPeer(chatId);
        await this.getOrCreateSession(chatId);
        return {
          reply: previousSessionId
            ? `Новая сессия csagent (было ${previousSessionId}). Контекст сброшен — можно писать заново.`
            : "Новая сессия csagent. Контекст сброшен — можно писать заново.",
        };
      }
      const session = await this.getOrCreateSession(chatId);
      const out = await session.sendTurn(text);
      if (out.kind === "ok") return { reply: out.assistantText };
      if (out.kind === "blocked") throw new GatewayRouterError(out.reason);
      const partial = out.partialAssistantText?.trim();
      throw new GatewayRouterError(partial ? `${out.message}\n\n${partial}` : out.message);
    } finally {
      this.busy.delete(key);
    }
  }

  async closeAll(): Promise<void> {
    const closing = [...this.active.values()].map((s) => s.close());
    this.active.clear();
    await Promise.all(closing);
  }
}
