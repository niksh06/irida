/**
 * SQLite → Postgres one-shot migration (I-28).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, resolveMemoryRoot } from "./config.js";
import { SqliteStore, PostgresStore, type RunRecord } from "./store.js";
import { SqliteMemoryStore, PostgresMemoryStore, type MemoryFact } from "./memoryStore.js";
export interface StoreMigrateResult {
  sessions: number;
  runs: number;
  notes: number;
  facts: number;
}

function factKey(f: Pick<MemoryFact, "subject" | "predicate" | "object" | "valid_from" | "valid_to">): string {
  return [f.subject, f.predicate, f.object, f.valid_from ?? "", f.valid_to ?? ""].join("\u0000");
}

/** Copy memory notes + facts (idempotent: notes upsert, facts deduped by content key). */
async function migrateMemory(
  dir: string,
  pgUrl: string,
  result: StoreMigrateResult
): Promise<void> {
  const memRoot = resolveMemoryRoot(dir);
  if (!existsSync(resolve(memRoot, "state.sqlite"))) return;
  const srcMem = new SqliteMemoryStore(memRoot);
  const dstMem = new PostgresMemoryStore(pgUrl);
  try {
    for (const note of await srcMem.listNotes()) {
      await dstMem.upsertNote({
        name: note.name,
        body: note.body,
        wing: note.wing,
        title: note.title,
      });
      result.notes++;
    }
    const subjects = (await srcMem.factAuditSummary()).subjects.map((s) => s.subject);
    for (const subject of subjects) {
      const srcFacts = await srcMem.queryFacts({ subject, currentOnly: false });
      const dstFacts = await dstMem.queryFacts({ subject, currentOnly: false });
      const seen = new Set(dstFacts.map(factKey));
      for (const f of srcFacts) {
        if (seen.has(factKey(f))) continue;
        const added = await dstMem.addFact({
          subject: f.subject,
          predicate: f.predicate,
          object: f.object,
          valid_from: f.valid_from,
          source: f.source,
        });
        if (f.valid_to) await dstMem.invalidateFact(added.id, f.valid_to);
        result.facts++;
      }
    }
  } finally {
    await srcMem.close();
    await dstMem.close();
  }
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
  // Intentional raw env manipulation (not a read to centralize via pgUrl): force
  // the *source* store to sqlite by hiding the PG url while constructing it.
  const prevPg = process.env.CSAGENT_DATABASE_URL;
  delete process.env.CSAGENT_DATABASE_URL;
  const src = new SqliteStore(dir, cfg.stateDir);
  if (prevPg) process.env.CSAGENT_DATABASE_URL = prevPg;
  const dst = new PostgresStore(pgUrl);
  const result: StoreMigrateResult = { sessions: 0, runs: 0, notes: 0, facts: 0 };

  try {
    const MIGRATE_SESSION_CAP = 100_000;
    const sessions = await src.listSessions(MIGRATE_SESSION_CAP);
    if (sessions.length === MIGRATE_SESSION_CAP) {
      console.error(
        `[store migrate] warning: hit ${MIGRATE_SESSION_CAP} session cap — older sessions were not migrated`
      );
    }
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

  await migrateMemory(dir, pgUrl, result);
  return result;
}
