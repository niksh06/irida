/**
 * SQLite → Postgres one-shot migration (I-28).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { SqliteStore, PostgresStore, type SessionRecord, type RunRecord } from "./store.js";
export interface StoreMigrateResult {
  sessions: number;
  runs: number;
  notes: number;
  facts: number;
}

export async function migrateSqliteToPostgres(
  dir: string,
  pgUrl: string
): Promise<StoreMigrateResult> {
  const cfg = loadConfig(dir);
  const sqlitePath = resolve(dir, cfg.stateDir, "state.sqlite");
  if (!existsSync(sqlitePath)) {
    throw new Error(`no sqlite at ${sqlitePath}`);
  }
  const prevPg = process.env.CSAGENT_DATABASE_URL;
  delete process.env.CSAGENT_DATABASE_URL;
  const src = new SqliteStore(dir, cfg.stateDir);
  if (prevPg) process.env.CSAGENT_DATABASE_URL = prevPg;
  const dst = new PostgresStore(pgUrl);
  const result: StoreMigrateResult = { sessions: 0, runs: 0, notes: 0, facts: 0 };

  try {
    const sessions = await src.listSessions(10_000);
    for (const s of sessions) {
      await dst.upsertSession({
        id: s.id,
        title: s.title,
        cwd: s.cwd,
        runtime: s.runtime,
        sdk_agent_id: s.sdk_agent_id,
        last_status: s.last_status,
        selected_skills: s.selected_skills,
        mcp_server_names: s.mcp_server_names,
        channel: s.channel ?? "",
      });
      result.sessions++;
      const runs = await src.listRuns(s.id);
      for (const r of runs) {
        await dst.recordRun(r as RunRecord);
        result.runs++;
      }
    }

  } finally {
    await src.close();
    await dst.close();
  }
  return result;
}
