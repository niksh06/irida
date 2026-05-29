/**
 * Project-local SQLite store (issue 007): ./<stateDir>/state.sqlite.
 * Sessions + runs metadata for listing, debugging, and SDK resume.
 * Uses Node's built-in node:sqlite (Node >= 22.5). Never stores secrets:
 * only redacted prompt previews and ids/status/timestamps land here.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
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

export class Store {
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
    // Back-compat: add result_preview to pre-existing runs tables.
    try {
      this.db.exec(`ALTER TABLE runs ADD COLUMN result_preview TEXT NOT NULL DEFAULT ''`);
    } catch {
      // column already exists
    }
  }

  upsertSession(s: {
    id: string;
    title: string;
    cwd: string;
    runtime: string;
    sdk_agent_id?: string | null;
    last_status?: string;
    selected_skills?: string;
    mcp_server_names?: string;
  }): void {
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

  recordRun(r: RunRecord): void {
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

  listSessions(limit = 50): SessionRecord[] {
    return this.db
      .prepare(`SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as unknown as SessionRecord[];
  }

  getSession(id: string): SessionRecord | undefined {
    return this.db.prepare(`SELECT * FROM sessions WHERE id=?`).get(id) as
      | SessionRecord
      | undefined;
  }

  listRuns(sessionId: string): RunRecord[] {
    return this.db
      .prepare(`SELECT * FROM runs WHERE session_id=? ORDER BY started_at`)
      .all(sessionId) as unknown as RunRecord[];
  }

  close(): void {
    this.db.close();
  }
}
