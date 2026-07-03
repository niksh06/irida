import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  PostgresMemoryStore,
  SqliteMemoryStore,
  SECURE_WING,
  SECURE_BODY_PLACEHOLDER,
} from "../src/memoryStore.js";
import { EMBEDDINGS_DIM } from "../src/embeddings.js";

const PG_URL = (process.env.IRIDA_TEST_PG_URL ?? process.env.CSAGENT_TEST_PG_URL)?.trim();

test("sqlite store refuses secure wing (no pgcrypto)", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "securemem-"));
  const store = new SqliteMemoryStore(dir);
  await assert.rejects(
    () => store.upsertNote({ name: "vault", body: "token=very-secret", wing: SECURE_WING }),
    /Postgres store/
  );
  await store.close();
});

test(
  "postgres semantic search orders by cosine distance (I-36)",
  { skip: !PG_URL ? "set IRIDA_TEST_PG_URL to run" : false },
  async () => {
    // Deterministic fake embedder: axis-aligned vectors per known text.
    const axis = (i: number) => {
      const v = new Array(EMBEDDINGS_DIM).fill(0);
      v[i] = 1;
      return v;
    };
    const vectors = new Map<string, number[]>();
    const embedder = async (text: string) => {
      for (const [k, v] of vectors) if (text.includes(k)) return v;
      return null;
    };
    vectors.set("kafka", axis(0));
    vectors.set("postgres", axis(1));
    // Query vector leans strongly toward kafka.
    const queryVec = new Array(EMBEDDINGS_DIM).fill(0);
    queryVec[0] = 0.9;
    queryVec[1] = 0.1;
    vectors.set("QUERYMARKER", queryVec);

    const store = new PostgresMemoryStore(PG_URL!, { embedder });
    const a = `semvec-kafka-${Date.now()}`;
    const b = `semvec-postgres-${Date.now()}`;
    try {
      await store.upsertNote({ name: a, body: "kafka consumer groups rebalance", wing: "t" });
      await store.upsertNote({ name: b, body: "postgres vacuum tuning", wing: "t" });
      const hits = await store.searchNotesSemantic("QUERYMARKER", 2);
      const names = hits.map((n) => n.name).filter((n) => n === a || n === b);
      assert.deepEqual(names, [a, b]); // kafka note closer to the query vector
      const updated = await store.reindexEmbeddings();
      assert.equal(typeof updated, "number");
    } finally {
      await store.deleteNote(a).catch(() => {});
      await store.deleteNote(b).catch(() => {});
      await store.close();
    }
  }
);

test(
  "postgres secure wing: encrypted at rest, decrypt on show, masked in list/search (I-20)",
  { skip: !PG_URL ? "set IRIDA_TEST_PG_URL to run" : false },
  async () => {
    const prevKey = process.env.CSAGENT_SECRETS_KEY;
    process.env.CSAGENT_SECRETS_KEY = "memory-secure-test-key-32chars-ok";
    const store = new PostgresMemoryStore(PG_URL!);
    const name = `securetest-${Date.now()}`;
    try {
      await store.upsertNote({
        name,
        body: "# Vault\ntoken=super-secret-value-12345",
        wing: SECURE_WING,
      });

      // getNote decrypts.
      const note = await store.getNote(name);
      assert.ok(note);
      assert.match(note!.body, /super-secret-value-12345/);
      assert.equal(note!.wing, SECURE_WING);

      // list masks body.
      const listed = (await store.listNotes(SECURE_WING)).find((n) => n.name === name);
      assert.ok(listed);
      assert.equal(listed!.body, SECURE_BODY_PLACEHOLDER);

      // Secure wing is excluded from default search (I-73/I-75) — name must NOT surface it.
      const byNameDefault = await store.searchNotes(name, 10);
      assert.ok(!byNameDefault.some((n) => n.name === name));
      // Opt into the secure wing explicitly → found by name, body still masked.
      const byNameSecure = await store.searchNotes(name, 10, { wings: [SECURE_WING] });
      assert.ok(byNameSecure.some((n) => n.name === name && n.body === SECURE_BODY_PLACEHOLDER));
      // Body content never leaks via search, even when the secure wing is opted in.
      const byBody = await store.searchNotes("super-secret-value-12345", 10, { wings: [SECURE_WING] });
      assert.ok(!byBody.some((n) => n.name === name));

      // Raw row: body empty, ciphertext present (verified via placeholder when key missing).
      delete process.env.CSAGENT_SECRETS_KEY;
      const noKey = await store.getNote(name);
      assert.equal(noKey!.body, SECURE_BODY_PLACEHOLDER);
      process.env.CSAGENT_SECRETS_KEY = "memory-secure-test-key-32chars-ok";

      // Wrong key → pgcrypto error, not silent plaintext.
      process.env.CSAGENT_SECRETS_KEY = "wrong-key-but-long-enough-32char";
      await assert.rejects(() => store.getNote(name));
      process.env.CSAGENT_SECRETS_KEY = "memory-secure-test-key-32chars-ok";
    } finally {
      await store.deleteNote(name).catch(() => {});
      await store.close();
      if (prevKey === undefined) delete process.env.CSAGENT_SECRETS_KEY;
      else process.env.CSAGENT_SECRETS_KEY = prevKey;
    }
  }
);
