import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteStore, PostgresStore, createStore } from "../src/store.js";
import {
  SqliteMemoryStore,
  PostgresMemoryStore,
  createMemoryStore,
} from "../src/memoryStore.js";

/**
 * Arch-7 lock: both backends sit behind one interface and the factory is the
 * single place that picks sqlite vs postgres. If someone adds a method to the
 * interface and forgets an implementation, or re-introduces backend branching
 * outside the factory, these tests fail.
 *
 * The bogus URL never connects — the PG stores acquire a lazy pg.Pool and only
 * dial out on first query, so constructing/closing them here is offline-safe.
 */
const ISTORE_METHODS = [
  "upsertSession",
  "recordRun",
  "listSessions",
  "getSession",
  "updateSessionTitle",
  "listRuns",
  "close",
];
const IMEMORY_METHODS = [
  "upsertNote",
  "getNote",
  "listNotes",
  "deleteNote",
  "searchNotes",
  "addFact",
  "queryFacts",
  "factAuditSummary",
  "invalidateFact",
  "pruneCurrentFacts",
  "countMalformedSubjectFacts",
  "purgeMalformedSubjectFacts",
  "close",
];
const BOGUS_PG = "postgresql://u:p@127.0.0.1:1/none";

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), "store-arch-"));
}

function hasMethods(obj: object, names: string[], label: string): void {
  const o = obj as Record<string, unknown>;
  for (const m of names) assert.equal(typeof o[m], "function", `${label}.${m}`);
}

test("both IStore implementations cover the full interface surface", async () => {
  const sqlite = new SqliteStore(tmp(), tmp());
  const pg = new PostgresStore(BOGUS_PG);
  try {
    hasMethods(sqlite, ISTORE_METHODS, "SqliteStore");
    hasMethods(pg, ISTORE_METHODS, "PostgresStore");
  } finally {
    await sqlite.close();
    await pg.close();
  }
});

test("both IMemoryStore implementations cover the full interface surface", async () => {
  const sqlite = new SqliteMemoryStore(tmp());
  const pg = new PostgresMemoryStore(BOGUS_PG);
  try {
    hasMethods(sqlite, IMEMORY_METHODS, "SqliteMemoryStore");
    hasMethods(pg, IMEMORY_METHODS, "PostgresMemoryStore");
  } finally {
    await sqlite.close();
    await pg.close();
  }
});

function withDbUrl<T>(url: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.CSAGENT_DATABASE_URL;
  if (url === undefined) delete process.env.CSAGENT_DATABASE_URL;
  else process.env.CSAGENT_DATABASE_URL = url;
  return (async () => {
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete process.env.CSAGENT_DATABASE_URL;
      else process.env.CSAGENT_DATABASE_URL = prev;
    }
  })();
}

test("createStore dispatches by backend (sqlite without a URL, postgres with one)", async () => {
  // No DB URL → sqlite, and the IStore contract round-trips end to end.
  await withDbUrl(undefined, async () => {
    const dir = tmp();
    const store = createStore(dir, dir);
    await store.upsertSession({
      id: "s1",
      title: "t",
      cwd: dir,
      runtime: "local",
      sdk_agent_id: null,
      channel: "cli",
    });
    assert.equal((await store.getSession("s1"))?.id, "s1");
    await store.close();
  });

  // DB URL set → postgres backend; it must not touch the sqlite filesystem.
  await withDbUrl(BOGUS_PG, async () => {
    const dir = tmp();
    const store = createStore(dir, dir);
    await store.close();
    const sqliteFiles = readdirSync(dir).filter((f) => f.includes("sqlite"));
    assert.deepEqual(sqliteFiles, [], "postgres backend should not create a sqlite db file");
  });
});

test("createMemoryStore dispatches by backend", async () => {
  await withDbUrl(BOGUS_PG, async () => {
    const dir = tmp();
    const store = createMemoryStore(dir);
    await store.close();
    const sqliteFiles = readdirSync(dir).filter((f) => f.includes("sqlite"));
    assert.deepEqual(sqliteFiles, [], "postgres backend should not create a sqlite db file");
  });
});
