/**
 * `cursor-agent sessions` — list stored sessions (issue 010), newest first.
 */
import { loadConfig, ConfigError } from "./config.js";
import { createStore } from "./store.js";
import { searchSessions } from "./sessionSearch.js";
import { redact } from "./redact.js";
import { EXIT, type ExitCode } from "./exit.js";

export async function cmdSessionsSearch(
  query: string,
  dir: string = process.cwd()
): Promise<ExitCode> {
  let cfg;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    console.error("sessions: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }
  const store = createStore(dir, cfg.stateDir);
  try {
    const hits = await searchSessions(store, query, { limit: 30 });
    if (hits.length === 0) {
      console.log(`No sessions matching "${query}".`);
      return EXIT.ok;
    }
    for (const s of hits) {
      const title = redact(s.title || "(untitled)");
      console.log(`${s.id}  [${s.last_status || "?"}]  ${s.updated_at}\n  ${title}`);
    }
    return EXIT.ok;
  } finally {
    await store.close();
  }
}

export async function cmdSessions(argv: string[] = [], dir: string = process.cwd()): Promise<ExitCode> {
  const [sub, ...rest] = argv;
  if (sub === "search") {
    return cmdSessionsSearch(rest.join(" "), dir);
  }
  let cfg;
  try {
    cfg = loadConfig(dir);
  } catch (e) {
    console.error("sessions: " + (e instanceof ConfigError ? e.message : String(e)));
    return EXIT.config;
  }

  const store = createStore(dir, cfg.stateDir);
  try {
    const rows = await store.listSessions();
    if (rows.length === 0) {
      console.log("No sessions yet. Run `cursor-agent run \"...\"` or `cursor-agent chat`.");
      return EXIT.ok;
    }
    for (const s of rows) {
      const title = redact(s.title || "(untitled)");
      console.log(
        `${s.id}  [${s.last_status || "?"}]  ${s.updated_at}\n  ${title}\n  cwd: ${s.cwd}`
      );
    }
    return EXIT.ok;
  } finally {
    await store.close();
  }
}
