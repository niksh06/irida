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

const PG_URL = process.env.CSAGENT_TEST_PG_URL?.trim();

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
  "postgres secure wing: encrypted at rest, decrypt on show, masked in list/search (I-20)",
  { skip: !PG_URL ? "set CSAGENT_TEST_PG_URL to run" : false },
  async () => {
    const prevKey = process.env.CSAGENT_SECRETS_KEY;
    process.env.CSAGENT_SECRETS_KEY = "test-secrets-key";
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

      // search by name matches, body masked; body content does not match.
      const byName = await store.searchNotes(name, 10);
      assert.ok(byName.some((n) => n.name === name && n.body === SECURE_BODY_PLACEHOLDER));
      const byBody = await store.searchNotes("super-secret-value-12345", 10);
      assert.ok(!byBody.some((n) => n.name === name));

      // Raw row: body empty, ciphertext present (verified via placeholder when key missing).
      delete process.env.CSAGENT_SECRETS_KEY;
      const noKey = await store.getNote(name);
      assert.equal(noKey!.body, SECURE_BODY_PLACEHOLDER);
      process.env.CSAGENT_SECRETS_KEY = "test-secrets-key";

      // Wrong key → pgcrypto error, not silent plaintext.
      process.env.CSAGENT_SECRETS_KEY = "wrong-key";
      await assert.rejects(() => store.getNote(name));
      process.env.CSAGENT_SECRETS_KEY = "test-secrets-key";
    } finally {
      await store.deleteNote(name).catch(() => {});
      await store.close();
      if (prevKey === undefined) delete process.env.CSAGENT_SECRETS_KEY;
      else process.env.CSAGENT_SECRETS_KEY = prevKey;
    }
  }
);
