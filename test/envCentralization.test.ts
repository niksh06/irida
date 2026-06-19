import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Arch-4 invariant: nothing reads process.env.CSAGENT_* directly except the
 * env accessor layer (env.ts), the DB pool leaf (pg/pool.ts), and storeMigrate
 * (which intentionally deletes/restores CSAGENT_DATABASE_URL to force a sqlite
 * source). Everything else must go through src/env.ts so each knob has one home.
 */
const ALLOWED = new Set(["env.ts", "pg/pool.ts", "storeMigrate.ts"]);
const SRC = resolve(import.meta.dirname, "..", "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("no direct process.env.CSAGENT_* reads outside the env layer", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    if (!/process\.env\.CSAGENT_/.test(readFileSync(file, "utf8"))) continue;
    const rel = file.slice(SRC.length + 1);
    if (!ALLOWED.has(rel)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `route these through src/env.ts accessors: ${offenders.join(", ")}`
  );
});
