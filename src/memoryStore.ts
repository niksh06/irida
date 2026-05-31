/**
 * csagent-memory: verbatim notes + temporal facts in SQLite or Postgres.
 * Replaces external MemPalace; shares CSAGENT_DATABASE_URL with session store.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { redact } from "./redact.js";
import { newId, nowIso } from "./util.js";

export interface MemoryNote {
  name: string;
  wing: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  valid_from: string | null;
  valid_to: string | null;
  source: string;
  created_at: string;
}

export interface UpsertNoteInput {
  name: string;
  body: string;
  wing?: string;
  title?: string;
}

export interface AddFactInput {
  subject: string;
  predicate: string;
  object: string;
  valid_from?: string | null;
  source?: string;
}

export interface QueryFactsInput {
  subject: string;
  predicate?: string;
  as_of?: string;
  currentOnly?: boolean;
}

export interface IMemoryStore {
  upsertNote(input: UpsertNoteInput): Promise<MemoryNote>;
  getNote(name: string): Promise<MemoryNote | undefined>;
  listNotes(wing?: string): Promise<MemoryNote[]>;
  deleteNote(name: string): Promise<boolean>;
  searchNotes(query: string, limit?: number): Promise<MemoryNote[]>;
  addFact(input: AddFactInput): Promise<MemoryFact>;
  queryFacts(input: QueryFactsInput): Promise<MemoryFact[]>;
  invalidateFact(id: string, ended?: string): Promise<boolean>;
  close(): Promise<void>;
}

const MEMORY_MIGRATION = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../deploy/postgres/migrations/003_memory.sql"),
  "utf8"
);

function titleFromBody(name: string, body: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim() || name;
}

const SQLITE_MEMORY_DDL = `
  CREATE TABLE IF NOT EXISTS memory_notes (
    name TEXT PRIMARY KEY,
    wing TEXT NOT NULL DEFAULT 'default',
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memory_notes_wing ON memory_notes(wing, updated_at DESC);
  CREATE TABLE IF NOT EXISTS memory_facts (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT NOT NULL,
    valid_from TEXT,
    valid_to TEXT,
    source TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memory_facts_subject ON memory_facts(subject, predicate);
  CREATE INDEX IF NOT EXISTS idx_memory_facts_lookup ON memory_facts(subject, predicate, object);
`;

export class SqliteMemoryStore implements IMemoryStore {
  private db: DatabaseSync;

  constructor(dir: string, stateDir: string) {
    const target = resolve(dir, stateDir);
    mkdirSync(target, { recursive: true });
    this.db = new DatabaseSync(resolve(target, "state.sqlite"));
    this.db.exec(SQLITE_MEMORY_DDL);
  }

  async upsertNote(input: UpsertNoteInput): Promise<MemoryNote> {
    const now = nowIso();
    const name = input.name.trim();
    const body = redact(input.body.trim());
    const wing = input.wing?.trim() || "default";
    const title = redact(input.title?.trim() || titleFromBody(name, body));
    const existing = await this.getNote(name);
    this.db
      .prepare(
        `INSERT INTO memory_notes (name, wing, title, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           wing=excluded.wing, title=excluded.title, body=excluded.body, updated_at=excluded.updated_at`
      )
      .run(name, wing, title, body, existing?.created_at ?? now, now);
    return (await this.getNote(name))!;
  }

  async getNote(name: string): Promise<MemoryNote | undefined> {
    return this.db.prepare(`SELECT * FROM memory_notes WHERE name=?`).get(name.trim()) as MemoryNote | undefined;
  }

  async listNotes(wing?: string): Promise<MemoryNote[]> {
    if (wing?.trim()) {
      return this.db
        .prepare(`SELECT * FROM memory_notes WHERE wing=? ORDER BY updated_at DESC`)
        .all(wing.trim()) as unknown as MemoryNote[];
    }
    return this.db
      .prepare(`SELECT * FROM memory_notes ORDER BY updated_at DESC`)
      .all() as unknown as MemoryNote[];
  }

  async deleteNote(name: string): Promise<boolean> {
    const r = this.db.prepare(`DELETE FROM memory_notes WHERE name=?`).run(name.trim());
    return r.changes > 0;
  }

  async searchNotes(query: string, limit = 20): Promise<MemoryNote[]> {
    const q = `%${query.trim()}%`;
    return this.db
      .prepare(
        `SELECT * FROM memory_notes
         WHERE name LIKE ? OR title LIKE ? OR body LIKE ?
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all(q, q, q, limit) as unknown as MemoryNote[];
  }

  async addFact(input: AddFactInput): Promise<MemoryFact> {
    const now = nowIso();
    const row: MemoryFact = {
      id: newId("fact"),
      subject: input.subject.trim(),
      predicate: input.predicate.trim(),
      object: input.object.trim(),
      valid_from: input.valid_from?.trim() || null,
      valid_to: null,
      source: redact(input.source?.trim() || ""),
      created_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO memory_facts (id, subject, predicate, object, valid_from, valid_to, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.subject,
        row.predicate,
        row.object,
        row.valid_from,
        row.valid_to,
        row.source,
        row.created_at
      );
    return row;
  }

  async queryFacts(input: QueryFactsInput): Promise<MemoryFact[]> {
    const params: (string | number)[] = [input.subject.trim()];
    const clauses = [`subject = ?`];
    if (input.predicate?.trim()) {
      clauses.push(`predicate = ?`);
      params.push(input.predicate.trim());
    }
    if (input.currentOnly !== false) {
      clauses.push(`(valid_to IS NULL OR valid_to = '')`);
    }
    if (input.as_of?.trim()) {
      clauses.push(`(valid_from IS NULL OR valid_from = '' OR valid_from <= ?)`);
      params.push(input.as_of.trim());
      clauses.push(`(valid_to IS NULL OR valid_to = '' OR valid_to >= ?)`);
      params.push(input.as_of.trim());
    }
    const sql = `SELECT * FROM memory_facts WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`;
    return this.db.prepare(sql).all(...params) as unknown as MemoryFact[];
  }

  async invalidateFact(id: string, ended?: string): Promise<boolean> {
    const when = ended?.trim() || nowIso().slice(0, 10);
    const r = this.db
      .prepare(`UPDATE memory_facts SET valid_to=? WHERE id=? AND (valid_to IS NULL OR valid_to='')`)
      .run(when, id.trim());
    return r.changes > 0;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export class PostgresMemoryStore implements IMemoryStore {
  private pool: pg.Pool;
  private migrated = false;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 5 });
  }

  private async ensureMigrated(): Promise<void> {
    if (this.migrated) return;
    await this.pool.query(MEMORY_MIGRATION);
    this.migrated = true;
  }

  async upsertNote(input: UpsertNoteInput): Promise<MemoryNote> {
    await this.ensureMigrated();
    const now = nowIso();
    const name = input.name.trim();
    const body = redact(input.body.trim());
    const wing = input.wing?.trim() || "default";
    const title = redact(input.title?.trim() || titleFromBody(name, body));
    const existing = await this.getNote(name);
    await this.pool.query(
      `INSERT INTO memory_notes (name, wing, title, body, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT(name) DO UPDATE SET
         wing=EXCLUDED.wing, title=EXCLUDED.title, body=EXCLUDED.body, updated_at=EXCLUDED.updated_at`,
      [name, wing, title, body, existing?.created_at ?? now, now]
    );
    return (await this.getNote(name))!;
  }

  async getNote(name: string): Promise<MemoryNote | undefined> {
    await this.ensureMigrated();
    const res = await this.pool.query(`SELECT * FROM memory_notes WHERE name=$1`, [name.trim()]);
    return (res.rows[0] as MemoryNote | undefined) ?? undefined;
  }

  async listNotes(wing?: string): Promise<MemoryNote[]> {
    await this.ensureMigrated();
    if (wing?.trim()) {
      const res = await this.pool.query(
        `SELECT * FROM memory_notes WHERE wing=$1 ORDER BY updated_at DESC`,
        [wing.trim()]
      );
      return res.rows as MemoryNote[];
    }
    const res = await this.pool.query(`SELECT * FROM memory_notes ORDER BY updated_at DESC`);
    return res.rows as MemoryNote[];
  }

  async deleteNote(name: string): Promise<boolean> {
    await this.ensureMigrated();
    const res = await this.pool.query(`DELETE FROM memory_notes WHERE name=$1`, [name.trim()]);
    return (res.rowCount ?? 0) > 0;
  }

  async searchNotes(query: string, limit = 20): Promise<MemoryNote[]> {
    await this.ensureMigrated();
    const res = await this.pool.query(
      `SELECT * FROM memory_notes
       WHERE name ILIKE $1 OR title ILIKE $1 OR body ILIKE $1
       ORDER BY updated_at DESC LIMIT $2`,
      [`%${query.trim()}%`, limit]
    );
    return res.rows as MemoryNote[];
  }

  async addFact(input: AddFactInput): Promise<MemoryFact> {
    await this.ensureMigrated();
    const now = nowIso();
    const row: MemoryFact = {
      id: newId("fact"),
      subject: input.subject.trim(),
      predicate: input.predicate.trim(),
      object: input.object.trim(),
      valid_from: input.valid_from?.trim() || null,
      valid_to: null,
      source: redact(input.source?.trim() || ""),
      created_at: now,
    };
    await this.pool.query(
      `INSERT INTO memory_facts (id, subject, predicate, object, valid_from, valid_to, source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        row.id,
        row.subject,
        row.predicate,
        row.object,
        row.valid_from,
        row.valid_to,
        row.source,
        row.created_at,
      ]
    );
    return row;
  }

  async queryFacts(input: QueryFactsInput): Promise<MemoryFact[]> {
    await this.ensureMigrated();
    const params: unknown[] = [input.subject.trim()];
    const clauses = [`subject = $1`];
    let n = 2;
    if (input.predicate?.trim()) {
      clauses.push(`predicate = $${n++}`);
      params.push(input.predicate.trim());
    }
    if (input.currentOnly !== false) {
      clauses.push(`(valid_to IS NULL OR valid_to = '')`);
    }
    if (input.as_of?.trim()) {
      clauses.push(`(valid_from IS NULL OR valid_from = '' OR valid_from <= $${n++})`);
      params.push(input.as_of.trim());
      clauses.push(`(valid_to IS NULL OR valid_to = '' OR valid_to >= $${n++})`);
      params.push(input.as_of.trim());
    }
    const sql = `SELECT * FROM memory_facts WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`;
    const res = await this.pool.query(sql, params);
    return res.rows as MemoryFact[];
  }

  async invalidateFact(id: string, ended?: string): Promise<boolean> {
    await this.ensureMigrated();
    const when = ended?.trim() || nowIso().slice(0, 10);
    const res = await this.pool.query(
      `UPDATE memory_facts SET valid_to=$1 WHERE id=$2 AND (valid_to IS NULL OR valid_to='')`,
      [when, id.trim()]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createMemoryStore(dir: string, stateDir: string): IMemoryStore {
  const url = process.env.CSAGENT_DATABASE_URL?.trim();
  if (url) return new PostgresMemoryStore(url);
  return new SqliteMemoryStore(dir, stateDir);
}
