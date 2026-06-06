/**
 * Maps (adapter, chatId) → stable sess_ and reuses open ChatSession handles.
 */
import { openChatSession, type ChatSession, type TurnHooks } from "./chatEngine.js";
import type { SdkCreateLike, SdkResumeLike } from "./host.js";
import {
  loadGatewayPeers,
  saveGatewayPeers,
  peerKey,
  type GatewayPeersFile,
} from "./gatewayPeers.js";
import type { SessionChannel } from "./sessionChannel.js";
import { parseDigestFollowup } from "./gatewayDigestFollowup.js";
import { handleGatewaySlash, isGatewaySlashCommand } from "./gatewaySlash.js";
import { loadGatewayConfig, type GatewayConfig } from "./gatewayConfig.js";
import { defaultServiceLogSink } from "./serviceLog.js";

export { GATEWAY_PEERS_FILE, loadGatewayPeers, saveGatewayPeers, peerKey } from "./gatewayPeers.js";
export type { GatewayPeersFile } from "./gatewayPeers.js";

export class GatewayRouterError extends Error {}

export interface GatewayRouterOptions {
  dir: string;
  adapter: string;
  skills?: string[];
  yesIUnderstand?: boolean;
  sdk?: SdkCreateLike & SdkResumeLike;
  onLog?: (line: string, level?: import("./serviceLog.js").ServiceLogLevel) => void;
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
    this.onLog = opts.onLog ?? defaultServiceLogSink;
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
      channel: this.adapter as SessionChannel,
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

  async handleInbound(
    chatId: string,
    text: string,
    hooks?: TurnHooks
  ): Promise<{ reply: string }> {
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
      if (isGatewaySlashCommand(text)) {
        let gwCfg;
        try {
          gwCfg = loadGatewayConfig(this.dir);
        } catch {
          gwCfg = { skills: this.skills } as GatewayConfig;
        }
        const slashReply = await handleGatewaySlash(text, {
          dir: this.dir,
          adapter: this.adapter,
          chatId,
          cfg: gwCfg,
          skills: this.skills,
        });
        if (slashReply) return { reply: slashReply };
      }
      const session = await this.getOrCreateSession(chatId);
      const followup = parseDigestFollowup(text);
      const turnText = followup?.prompt ?? text;
      if (followup) {
        this.onLog(`[gateway] digest follow-up ${followup.label} chat=${chatId}`);
      }
      const out = await session.sendTurn(turnText, hooks);
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
