/**
 * Session/run persistence: SQLite (default) or Postgres via CSAGENT_DATABASE_URL.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { redact } from "./redact.js";
import { nowIso } from "./util.js";

export interface SessionRecord {
  id: string;
  title: string;
  cwd: string;
  runtime: string;
  sdk_agent_id: string | null;
  created_at: string;
  updated_at: string;
  last_status: string;
  selected_skills: string;
  mcp_server_names: string;
}

export interface RunRecord {
  id: string;
  session_id: string;
  sdk_agent_id: string | null;
  sdk_run_id: string | null;
  prompt_preview: string;
  result_preview: string;
  status: string;
  error_kind: string | null;
  started_at: string;
  finished_at: string | null;
  cwd: string;
  runtime: string;
  model: string;
}

export interface IStore {
  upsertSession(s: {
    id: string;
    title: string;
    cwd: string;
    runtime: string;
    sdk_agent_id?: string | null;
    last_status?: string;
    selected_skills?: string;
    mcp_server_names?: string;
  }): Promise<void>;
  recordRun(r: RunRecord): Promise<void>;
  listSessions(limit?: number): Promise<SessionRecord[]>;
  getSession(id: string): Promise<SessionRecord | undefined>;
  updateSessionTitle(id: string, title: string): Promise<boolean>;
  listRuns(sessionId: string): Promise<RunRecord[]>;
  close(): Promise<void>;
}

const SESSIONS_RUNS_MIGRATION = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../deploy/postgres/migrations/001_sessions_runs.sql"),
  "utf8"
);

/** SQLite under <stateDir>/state.sqlite (Node >= 22.5). */
export class SqliteStore implements IStore {
  private db: DatabaseSync;

  constructor(dir: string, stateDir: string) {
    const target = resolve(dir, stateDir);
    mkdirSync(target, { recursive: true });
    this.db = new DatabaseSync(resolve(target, "state.sqlite"));
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        cwd TEXT NOT NULL DEFAULT '',
        runtime TEXT NOT NULL DEFAULT 'local',
        sdk_agent_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_status TEXT NOT NULL DEFAULT '',
        selected_skills TEXT NOT NULL DEFAULT '',
        mcp_server_names TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sdk_agent_id TEXT,
        sdk_run_id TEXT,
        prompt_preview TEXT NOT NULL DEFAULT '',
        result_preview TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        error_kind TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        cwd TEXT NOT NULL DEFAULT '',
        runtime TEXT NOT NULL DEFAULT 'local',
        model TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id);
    `);
    try {
      this.db.exec(`ALTER TABLE runs ADD COLUMN result_preview TEXT NOT NULL DEFAULT ''`);
    } catch {
      /* column exists */
    }
  }

  async upsertSession(s: Parameters<IStore["upsertSession"]>[0]): Promise<void> {
    const now = nowIso();
    const title = redact(s.title);
    this.db
      .prepare(
        `INSERT INTO sessions (id,title,cwd,runtime,sdk_agent_id,created_at,updated_at,last_status,selected_skills,mcp_server_names)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, cwd=excluded.cwd, runtime=excluded.runtime,
           sdk_agent_id=COALESCE(excluded.sdk_agent_id, sessions.sdk_agent_id),
           updated_at=excluded.updated_at, last_status=excluded.last_status`
      )
      .run(
        s.id,
        title,
        s.cwd,
        s.runtime,
        s.sdk_agent_id ?? null,
        now,
        now,
        s.last_status ?? "",
        s.selected_skills ?? "",
        s.mcp_server_names ?? ""
      );
  }

  async recordRun(r: RunRecord): Promise<void> {
    const rec = {
      ...r,
      prompt_preview: redact(r.prompt_preview),
      result_preview: redact(r.result_preview ?? ""),
    };
    this.db
      .prepare(
        `INSERT INTO runs (id,session_id,sdk_agent_id,sdk_run_id,prompt_preview,result_preview,status,error_kind,started_at,finished_at,cwd,runtime,model)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        rec.id,
        rec.session_id,
        rec.sdk_agent_id,
        rec.sdk_run_id,
        rec.prompt_preview,
        rec.result_preview,
        rec.status,
        rec.error_kind,
        rec.started_at,
        rec.finished_at,
        rec.cwd,
        rec.runtime,
        rec.model
      );
  }

  async listSessions(limit = 50): Promise<SessionRecord[]> {
    return this.db
      .prepare(`SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as unknown as SessionRecord[];
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    return this.db.prepare(`SELECT * FROM sessions WHERE id=?`).get(id) as SessionRecord | undefined;
  }

  async updateSessionTitle(id: string, title: string): Promise<boolean> {
    const row = await this.getSession(id);
    if (!row) return false;
    await this.upsertSession({
      id: row.id,
      title: redact(title.trim() || row.title),
      cwd: row.cwd,
      runtime: row.runtime,
      sdk_agent_id: row.sdk_agent_id,
      last_status: row.last_status,
      selected_skills: row.selected_skills,
      mcp_server_names: row.mcp_server_names,
    });
    return true;
  }

  async listRuns(sessionId: string): Promise<RunRecord[]> {
    return this.db
      .prepare(`SELECT * FROM runs WHERE session_id=? ORDER BY started_at`)
      .all(sessionId) as unknown as RunRecord[];
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/** @deprecated use SqliteStore or createStore */
export const Store = SqliteStore;

/** Postgres backend (Phase 1). */
export class PostgresStore implements IStore {
  private pool: pg.Pool;
  private migrated = false;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 5 });
  }

  private async ensureMigrated(): Promise<void> {
    if (this.migrated) return;
    await this.pool.query(SESSIONS_RUNS_MIGRATION);
    this.migrated = true;
  }

  async upsertSession(s: Parameters<IStore["upsertSession"]>[0]): Promise<void> {
    await this.ensureMigrated();
    const now = nowIso();
    const title = redact(s.title);
    await this.pool.query(
      `INSERT INTO sessions (id,title,cwd,runtime,sdk_agent_id,created_at,updated_at,last_status,selected_skills,mcp_server_names)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(id) DO UPDATE SET
         title=EXCLUDED.title, cwd=EXCLUDED.cwd, runtime=EXCLUDED.runtime,
         sdk_agent_id=COALESCE(EXCLUDED.sdk_agent_id, sessions.sdk_agent_id),
         updated_at=EXCLUDED.updated_at, last_status=EXCLUDED.last_status`,
      [
        s.id,
        title,
        s.cwd,
        s.runtime,
        s.sdk_agent_id ?? null,
        now,
        now,
        s.last_status ?? "",
        s.selected_skills ?? "",
        s.mcp_server_names ?? "",
      ]
    );
  }

  async recordRun(r: RunRecord): Promise<void> {
    await this.ensureMigrated();
    const rec = {
      ...r,
      prompt_preview: redact(r.prompt_preview),
      result_preview: redact(r.result_preview ?? ""),
    };
    await this.pool.query(
      `INSERT INTO runs (id,session_id,sdk_agent_id,sdk_run_id,prompt_preview,result_preview,status,error_kind,started_at,finished_at,cwd,runtime,model)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        rec.id,
        rec.session_id,
        rec.sdk_agent_id,
        rec.sdk_run_id,
        rec.prompt_preview,
        rec.result_preview,
        rec.status,
        rec.error_kind,
        rec.started_at,
        rec.finished_at,
        rec.cwd,
        rec.runtime,
        rec.model,
      ]
    );
  }

  async listSessions(limit = 50): Promise<SessionRecord[]> {
    await this.ensureMigrated();
    const res = await this.pool.query(`SELECT * FROM sessions ORDER BY updated_at DESC LIMIT $1`, [limit]);
    return res.rows as SessionRecord[];
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    await this.ensureMigrated();
    const res = await this.pool.query(`SELECT * FROM sessions WHERE id=$1`, [id]);
    return (res.rows[0] as SessionRecord | undefined) ?? undefined;
  }

  async updateSessionTitle(id: string, title: string): Promise<boolean> {
    const row = await this.getSession(id);
    if (!row) return false;
    await this.upsertSession({
      id: row.id,
      title: redact(title.trim() || row.title),
      cwd: row.cwd,
      runtime: row.runtime,
      sdk_agent_id: row.sdk_agent_id,
      last_status: row.last_status,
      selected_skills: row.selected_skills,
      mcp_server_names: row.mcp_server_names,
    });
    return true;
  }

  async listRuns(sessionId: string): Promise<RunRecord[]> {
    await this.ensureMigrated();
    const res = await this.pool.query(`SELECT * FROM runs WHERE session_id=$1 ORDER BY started_at`, [sessionId]);
    return res.rows as RunRecord[];
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createStore(dir: string, stateDir: string): IStore {
  const url = process.env.CSAGENT_DATABASE_URL?.trim();
  if (url) return new PostgresStore(url);
  return new SqliteStore(dir, stateDir);
}

/** Ping Postgres when CSAGENT_DATABASE_URL is set (doctor). */
export async function probePostgresStore(connectionString: string): Promise<{ ok: boolean; detail: string }> {
  const store = new PostgresStore(connectionString);
  try {
    await store.listSessions(1);
    return { ok: true, detail: "connected, schema ready" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    await store.close();
  }
}
