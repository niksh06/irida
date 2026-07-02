import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  listMigrationFiles,
  resetPgMigrationsMemoForTest,
  runPgMigrations,
} from "../src/pg/migrations.js";

// I-141: tracked, ordered schema runner. Integration — needs a disposable PG
// (pgvector image) via IRIDA_TEST_PG_URL (legacy CSAGENT_TEST_PG_URL honored).
const TEST_PG_URL = process.env.IRIDA_TEST_PG_URL ?? process.env.CSAGENT_TEST_PG_URL ?? "";

test("migration filenames are unique by numeric prefix and ordered", () => {
  const files = listMigrationFiles();
  assert.ok(files.length >= 11);
  const prefixes = files.map((f) => f.slice(0, 3));
  assert.equal(new Set(prefixes).size, prefixes.length, `duplicate numeric prefix in: ${files.join(", ")}`);
  assert.deepEqual(files, [...files].sort());
});

test(
  "runner applies all migrations once, records them, and no-ops on the second pass",
  { skip: !TEST_PG_URL ? "IRIDA_TEST_PG_URL not set" : false },
  async () => {
    const pool = new pg.Pool({ connectionString: TEST_PG_URL, max: 2 });
    try {
      await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      resetPgMigrationsMemoForTest();
      await runPgMigrations(pool, "test-pass-1");

      const recorded = (await pool.query("SELECT filename FROM schema_migrations ORDER BY filename")).rows.map(
        (r: { filename: string }) => r.filename
      );
      assert.deepEqual(recorded, listMigrationFiles()); // pgvector image → 008 applies too

      // Cross-domain schema present from ONE pass (old code applied per-module subsets).
      for (const t of ["sessions", "runs", "memory_notes", "memory_facts", "credential_secrets", "gateway_allowed_chats"]) {
        const r = await pool.query("SELECT to_regclass($1) AS reg", [`public.${t}`]);
        assert.ok(r.rows[0].reg, `table ${t} missing after runner pass`);
      }

      // Second pass (fresh memo = fresh process) records nothing new and does not throw.
      resetPgMigrationsMemoForTest();
      await runPgMigrations(pool, "test-pass-2");
      const again = (await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n;
      assert.equal(again, recorded.length);
    } finally {
      await pool.end();
    }
  }
);

test(
  "runner replays idempotent migrations over a pre-runner database (prod upgrade path)",
  { skip: !TEST_PG_URL ? "IRIDA_TEST_PG_URL not set" : false },
  async () => {
    const pool = new pg.Pool({ connectionString: TEST_PG_URL, max: 2 });
    try {
      await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      // Simulate a pre-runner database: schema exists (created by the old lazy
      // per-module path), but schema_migrations does not.
      resetPgMigrationsMemoForTest();
      await runPgMigrations(pool, "seed");
      await pool.query("DROP TABLE schema_migrations");

      resetPgMigrationsMemoForTest();
      await runPgMigrations(pool, "upgrade");
      const n = (await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n;
      assert.equal(n, listMigrationFiles().length);
    } finally {
      await pool.end();
    }
  }
);
