/**
 * Golden memory search smoke (I-78) — fixture store, no live SDK/PG required.
 */
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMemoryStore } from "../../../src/memoryStore.js";

const caseDir = dirname(fileURLToPath(import.meta.url));

interface GoldenFixture {
  name: string;
  wing: string;
  title: string;
  body: string;
}

interface GoldenCase {
  query: string;
  expectTop1: string;
  mustNotWings?: string[];
}

interface GoldenManifest {
  topN?: number;
  fixtures: GoldenFixture[];
  cases: GoldenCase[];
}

export async function runMemorySearchGoldenSmoke(
  manifestPath: string = join(caseDir, "queries.json")
): Promise<{ ok: boolean; detail: string }> {
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as GoldenManifest;
  const topN = raw.topN ?? 5;
  const dir = mkdtempSync(join(tmpdir(), "mem-search-golden-"));
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent.config.json"),
    JSON.stringify({ model: "m", runtime: "local", cwd: dir, stateDir: ".agent" }),
    "utf8"
  );

  const store = createMemoryStore(dir);
  try {
    for (const f of raw.fixtures) {
      await store.upsertNote({
        name: f.name,
        wing: f.wing,
        title: f.title,
        body: f.body,
      });
    }
    for (const c of raw.cases) {
      const hits = await store.searchNotes(c.query, topN);
      if (hits.length === 0) {
        return { ok: false, detail: `${c.query}: no hits` };
      }
      if (hits[0]!.name !== c.expectTop1) {
        return {
          ok: false,
          detail: `${c.query}: top-1=${hits[0]!.name} expected ${c.expectTop1}`,
        };
      }
      for (const wing of c.mustNotWings ?? ["cursor-ide"]) {
        const bad = hits.filter((h) => h.wing === wing);
        if (bad.length) {
          return {
            ok: false,
            detail: `${c.query}: wing ${wing} in top-${topN}: ${bad.map((h) => h.name).join(",")}`,
          };
        }
      }
    }
  } finally {
    await store.close();
  }
  return { ok: true, detail: `${raw.cases.length} case(s) ok` };
}

async function main(): Promise<void> {
  const r = await runMemorySearchGoldenSmoke();
  if (!r.ok) {
    console.error(`memory-search-smoke FAIL: ${r.detail}`);
    process.exit(1);
  }
  console.log(`memory-search-smoke: ${r.detail}`);
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
