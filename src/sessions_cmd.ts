/**
 * `cursor-agent sessions` — list stored sessions (issue 010), newest first.
 */
import { loadConfig, ConfigError } from "./config.js";
import { createStore } from "./store.js";
import { redact } from "./redact.js";
import { EXIT, type ExitCode } from "./exit.js";

export async function cmdSessions(dir: string = process.cwd()): Promise<ExitCode> {
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
