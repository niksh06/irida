import { loadConfig, ConfigError } from "../config.js";
import { createStore, type SessionRecord } from "../store.js";

export async function listStoredSessions(dir: string = process.cwd()): Promise<SessionRecord[]> {
  let cfg;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    throw e instanceof ConfigError ? e : new ConfigError(String(e));
  }
  const store = createStore(dir, cfg.stateDir);
  try {
    return await store.listSessions(30);
  } finally {
    await store.close();
  }
}

export async function loadSessionRuns(dir: string, sessionId: string) {
  const cfg = loadConfig(dir);
  const store = createStore(dir, cfg.stateDir);
  try {
    return await store.listRuns(sessionId);
  } finally {
    await store.close();
  }
}

export async function renameStoredSession(dir: string, sessionId: string, title: string): Promise<boolean> {
  const cfg = loadConfig(dir);
  const store = createStore(dir, cfg.stateDir);
  try {
    return await store.updateSessionTitle(sessionId, title);
  } finally {
    await store.close();
  }
}
