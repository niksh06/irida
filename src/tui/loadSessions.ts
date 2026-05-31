import { loadConfig, ConfigError } from "../config.js";
import { createStore, type SessionRecord } from "../store.js";
import { SESSION_CHANNEL } from "../sessionChannel.js";
import { gatewayPeerSessionIds } from "../gatewayPeers.js";

export async function listStoredSessions(dir: string = process.cwd()): Promise<SessionRecord[]> {
  let cfg;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    throw e instanceof ConfigError ? e : new ConfigError(String(e));
  }
  const store = createStore(dir, cfg.stateDir);
  try {
    return await store.listSessions(30, {
      channel: SESSION_CHANNEL.tui,
      includeUnassigned: true,
      excludeIds: gatewayPeerSessionIds(dir),
    });
  } finally {
    await store.close();
  }
}

async function assertTuiSession(dir: string, sessionId: string): Promise<void> {
  const cfg = loadConfig(dir);
  const store = createStore(dir, cfg.stateDir);
  try {
    const row = await store.getSession(sessionId);
    if (!row) throw new Error(`session '${sessionId}' not found`);
    const peerIds = new Set(gatewayPeerSessionIds(dir));
    const ch = row.channel?.trim() ?? "";
    if (ch === SESSION_CHANNEL.telegram || ch === SESSION_CHANNEL.webhook || peerIds.has(sessionId)) {
      throw new Error(`session '${sessionId}' is owned by the gateway — pick another in TUI`);
    }
    if (ch && ch !== SESSION_CHANNEL.tui && ch !== SESSION_CHANNEL.cli) {
      throw new Error(`session '${sessionId}' is not a TUI session`);
    }
  } finally {
    await store.close();
  }
}

export async function loadSessionRuns(dir: string, sessionId: string) {
  await assertTuiSession(dir, sessionId);
  const cfg = loadConfig(dir);
  const store = createStore(dir, cfg.stateDir);
  try {
    return await store.listRuns(sessionId);
  } finally {
    await store.close();
  }
}

export async function renameStoredSession(dir: string, sessionId: string, title: string): Promise<boolean> {
  await assertTuiSession(dir, sessionId);
  const cfg = loadConfig(dir);
  const store = createStore(dir, cfg.stateDir);
  try {
    return await store.updateSessionTitle(sessionId, title);
  } finally {
    await store.close();
  }
}
