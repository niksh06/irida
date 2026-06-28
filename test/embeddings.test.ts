import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEmbedder, toVectorLiteral, EMBEDDINGS_DIM } from "../src/embeddings.js";

function fakeFetch(handler: (url: string, body: unknown) => Response): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) =>
    handler(String(url), init?.body ? JSON.parse(String(init.body)) : null)) as typeof fetch;
}

test("makeEmbedder disabled → undefined", () => {
  assert.equal(makeEmbedder(undefined), undefined);
  assert.equal(makeEmbedder({ enabled: false }), undefined);
});

test("embedder posts to ollama api and validates dim", async () => {
  const vec = Array.from({ length: EMBEDDINGS_DIM }, (_, i) => i / EMBEDDINGS_DIM);
  let seen: { url?: string; model?: string; prompt?: string } = {};
  const embed = makeEmbedder(
    { enabled: true, url: "http://127.0.0.1:11434/", model: "nomic-embed-text" },
    fakeFetch((url, body) => {
      const b = body as { model: string; prompt: string };
      seen = { url, model: b.model, prompt: b.prompt };
      return new Response(JSON.stringify({ embedding: vec }));
    })
  )!;
  const out = await embed("hello world");
  assert.deepEqual(out, vec);
  assert.equal(seen.url, "http://127.0.0.1:11434/api/embeddings");
  assert.equal(seen.model, "nomic-embed-text");
  assert.equal(seen.prompt, "hello world");
});

test("embed-service provider posts /embed {text} and reads {vector} (I-131)", async () => {
  const vec = Array.from({ length: EMBEDDINGS_DIM }, (_, i) => i / EMBEDDINGS_DIM);
  let seen: { url?: string; text?: string } = {};
  const embed = makeEmbedder(
    { enabled: true, provider: "embed-service", url: "http://127.0.0.1:8014" },
    fakeFetch((url, body) => {
      seen = { url, text: (body as { text: string }).text };
      return new Response(JSON.stringify({ model_name: "mpnet", dim: EMBEDDINGS_DIM, vector: vec }));
    })
  )!;
  const out = await embed("привет мир");
  assert.deepEqual(out, vec);
  assert.equal(seen.url, "http://127.0.0.1:8014/embed");
  assert.equal(seen.text, "привет мир");
});

test("embed-service fail-soft: wrong dim / missing vector → null", async () => {
  const e1 = makeEmbedder(
    { enabled: true, provider: "embed-service", url: "http://x" },
    fakeFetch(() => new Response(JSON.stringify({ vector: [1, 2, 3] })))
  )!;
  assert.equal(await e1("x"), null);
  const e2 = makeEmbedder(
    { enabled: true, provider: "embed-service", url: "http://x" },
    fakeFetch(() => new Response(JSON.stringify({ embedding: Array(EMBEDDINGS_DIM).fill(0) })))
  )!;
  assert.equal(await e2("x"), null); // embed-service reads `vector`, not `embedding`
});

test("embedder fail-soft: http error, wrong dim, network throw → null", async () => {
  const cases: Array<typeof fetch> = [
    fakeFetch(() => new Response("nope", { status: 500 })),
    fakeFetch(() => new Response(JSON.stringify({ embedding: [1, 2, 3] }))),
    (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch,
  ];
  for (const f of cases) {
    const embed = makeEmbedder({ enabled: true }, f)!;
    assert.equal(await embed("x"), null);
  }
  // Empty prompt short-circuits.
  const embed = makeEmbedder({ enabled: true }, fakeFetch(() => new Response("{}")))!;
  assert.equal(await embed("   "), null);
});

test("toVectorLiteral formats pgvector literal", () => {
  assert.equal(toVectorLiteral([0.1, -2, 3]), "[0.1,-2,3]");
});
