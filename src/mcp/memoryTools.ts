/**
 * csagent-memory MCP tool handlers (shared by stdio server and tests).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveMemoryRoot } from "../config.js";
import { saveMemory } from "../memory.js";
import { createMemoryStore, SECURE_WING } from "../memoryStore.js";

export interface MemoryMcpContext {
  dir: string;
  stateDir: string;
}

/** Tool names registered on csagent-memory (doctor / docs). */
export const MEMORY_MCP_TOOL_NAMES = [
  "memory_get",
  "memory_search",
  "memory_list",
  "memory_save",
  "memory_fact_query",
  "memory_fact_add",
  "memory_fact_invalidate",
] as const;

export function resolveMemoryMcpContext(): MemoryMcpContext {
  const dir = process.env.CSAGENT_MEMORY_DIR?.trim() || process.cwd();
  const stateDir = process.env.CSAGENT_STATE_DIR?.trim() || resolveMemoryRoot(dir);
  return { dir, stateDir };
}

async function withStore<T>(
  ctx: MemoryMcpContext,
  fn: (store: ReturnType<typeof createMemoryStore>) => Promise<T>
): Promise<T> {
  const store = createMemoryStore(ctx.dir, ctx.stateDir);
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export interface MemoryFactInvalidateInput {
  fact_id?: string;
  subject?: string;
  predicate?: string;
  object?: string;
}

/** Invalidate by id or by subject/predicate/object scope (I-53). */
export async function handleMemoryFactInvalidate(
  ctx: MemoryMcpContext,
  input: MemoryFactInvalidateInput
): Promise<string> {
  const id = input.fact_id?.trim();
  if (id) {
    const ok = await withStore(ctx, (s) => s.invalidateFact(id));
    return ok ? `fact invalidated: ${id}` : `fact not found or already ended: ${id}`;
  }
  const subject = input.subject?.trim();
  if (!subject) return "Provide fact_id or subject.";
  return withStore(ctx, async (s) => {
    const facts = await s.queryFacts({
      subject,
      predicate: input.predicate,
      object: input.object,
      currentOnly: true,
    });
    if (facts.length === 0) return "No matching current facts.";
    let n = 0;
    for (const f of facts) {
      if (await s.invalidateFact(f.id)) n++;
    }
    const scope = [
      `subject=${subject}`,
      input.predicate?.trim() ? `predicate=${input.predicate.trim()}` : "",
      input.object?.trim() ? `object=${input.object.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `invalidated ${n} fact(s) (${scope})`;
  });
}

export function registerMemoryMcpTools(server: McpServer, ctx: MemoryMcpContext): void {
  server.registerTool(
    "memory_get",
    {
      description: "Load a durable csagent memory note by name (verbatim markdown body).",
      inputSchema: {
        name: z.string().describe("Note name, e.g. tparser-workflow"),
      },
    },
    async ({ name }) => {
      const note = await withStore(ctx, (s) => s.getNote(name));
      if (!note) return textResult(`Not found: ${name}`);
      return textResult(
        `# ${note.title || note.name}\nwing: ${note.wing}\nupdated: ${note.updated_at}\n\n${note.body}`
      );
    }
  );

  server.registerTool(
    "memory_search",
    {
      description:
        "Search csagent memory notes. semantic=true uses local vector embeddings (paraphrase recall); default is keyword/FTS.",
      inputSchema: {
        query: z.string().describe("Search text"),
        limit: z.number().int().min(1).max(50).optional().describe("Max hits (default 10)"),
        semantic: z.boolean().optional().describe("Vector search via local embeddings (PG only)"),
        includeArchive: z
          .boolean()
          .optional()
          .describe("Include cursor-ide transcript archive wing (default false)"),
      },
    },
    async ({ query, limit, semantic, includeArchive }) => {
      const searchOpts = includeArchive ? { includeArchive: true } : undefined;
      const hits = await withStore(ctx, async (s) => {
        if (semantic && s.searchNotesSemantic) {
          const out = await s.searchNotesSemantic(query, limit ?? 10, searchOpts);
          if (out.length > 0) return out;
        }
        return s.searchNotes(query, limit ?? 10, searchOpts);
      });
      if (hits.length === 0) return textResult("No matches.");
      const lines = hits.map(
        (n) =>
          `- ${n.name} [${n.wing}] ${n.title}\n  ${n.body.replace(/\s+/g, " ").trim().slice(0, 200)}`
      );
      return textResult(lines.join("\n"));
    }
  );

  server.registerTool(
    "memory_list",
    {
      description: "List available csagent memory note names.",
      inputSchema: {
        wing: z.string().optional().describe("Filter by wing namespace"),
      },
    },
    async ({ wing }) => {
      const notes = await withStore(ctx, (s) => s.listNotes(wing));
      if (notes.length === 0) return textResult("No notes stored.");
      return textResult(
        notes.map((n) => `${n.name}\t[${n.wing}]\t${n.title}`).join("\n")
      );
    }
  );

  server.registerTool(
    "memory_save",
    {
      description:
        "Create or update a csagent memory note. Use for durable facts the user asked to remember.",
      inputSchema: {
        name: z.string().describe("Note name (letters, digits, ._-)"),
        body: z.string().describe("Markdown body"),
        wing: z.string().optional().describe("Optional wing namespace"),
      },
    },
    async ({ name, body, wing }) => {
      if (wing?.trim() === SECURE_WING) {
        // Never mirror secure notes to plaintext .md files.
        await withStore(ctx, (s) => s.upsertNote({ name, body, wing }));
        return textResult(`Saved encrypted note: ${name} (store only)`);
      }
      // File mirror first — read path (@memory, previews) prefers files.
      saveMemory(ctx.dir, name, body);
      await withStore(ctx, (s) => s.upsertNote({ name, body, wing }));
      return textResult(`Saved note: ${name}`);
    }
  );

  server.registerTool(
    "memory_fact_query",
    {
      description: "Query current temporal facts (subject/predicate/object triples).",
      inputSchema: {
        subject: z.string().describe("Fact subject, e.g. seen_post"),
        predicate: z.string().optional().describe("Optional predicate filter"),
      },
    },
    async ({ subject, predicate }) => {
      const facts = await withStore(ctx, (s) =>
        s.queryFacts({ subject, predicate, currentOnly: true })
      );
      if (facts.length === 0) return textResult("No current facts.");
      return textResult(
        facts
          .map((f) => `${f.id}\t${f.subject} ${f.predicate} ${f.object}`)
          .join("\n")
      );
    }
  );

  server.registerTool(
    "memory_fact_add",
    {
      description: "Add a temporal fact triple (dedup, preferences, seen-items).",
      inputSchema: {
        subject: z.string(),
        predicate: z.string(),
        object: z.string(),
      },
    },
    async ({ subject, predicate, object }) => {
      const fact = await withStore(ctx, (s) =>
        s.addFact({ subject, predicate, object, source: "mcp" })
      );
      return textResult(`fact ${fact.id}: ${subject} ${predicate} ${object}`);
    }
  );

  server.registerTool(
    "memory_fact_invalidate",
    {
      description:
        "Invalidate (close) temporal facts — by fact_id or by subject/predicate/object scope (sets valid_to).",
      inputSchema: {
        fact_id: z.string().optional().describe("Single fact id from memory_fact_query"),
        subject: z.string().optional().describe("Match scope: subject (required if no fact_id)"),
        predicate: z.string().optional().describe("Optional predicate filter"),
        object: z.string().optional().describe("Optional object filter"),
      },
    },
    async (args) => textResult(await handleMemoryFactInvalidate(ctx, args))
  );
}
