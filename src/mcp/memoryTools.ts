/**
 * csagent-memory MCP tool handlers (shared by stdio server and tests).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../config.js";
import { saveMemory } from "../memory.js";
import { createMemoryStore } from "../memoryStore.js";

export interface MemoryMcpContext {
  dir: string;
  stateDir: string;
}

export function resolveMemoryMcpContext(): MemoryMcpContext {
  const dir = process.env.CSAGENT_MEMORY_DIR?.trim() || process.cwd();
  const stateDir =
    process.env.CSAGENT_STATE_DIR?.trim() || loadConfig(dir).stateDir;
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
      description: "Search csagent memory notes by keyword (name, title, body).",
      inputSchema: {
        query: z.string().describe("Search text"),
        limit: z.number().int().min(1).max(50).optional().describe("Max hits (default 10)"),
      },
    },
    async ({ query, limit }) => {
      const hits = await withStore(ctx, (s) => s.searchNotes(query, limit ?? 10));
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
      await withStore(ctx, (s) => s.upsertNote({ name, body, wing }));
      saveMemory(ctx.dir, name, body);
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
}
