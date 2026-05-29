import { loadConfig, ConfigError } from "../config.js";
import { Store, type SessionRecord } from "../store.js";

export function listStoredSessions(dir: string = process.cwd()): SessionRecord[] {
  let cfg;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    throw e instanceof ConfigError ? e : new ConfigError(String(e));
  }
  const store = new Store(dir, cfg.stateDir);
  try {
    return store.listSessions(30);
  } finally {
    store.close();
  }
}

export function loadSessionRuns(dir: string, sessionId: string) {
  const cfg = loadConfig(dir);
  const store = new Store(dir, cfg.stateDir);
  try {
    return store.listRuns(sessionId);
  } finally {
    store.close();
  }
}
