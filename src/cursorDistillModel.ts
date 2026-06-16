import { resolveApiKey } from "./credentials.js";

/** Default SDK model for cursor-lesson distill subagents (I-65b). */
export const CURSOR_DISTILL_SUBAGENT_MODEL = "composer-2.5-fast";

/** Env override when SDK model list differs from IDE subagent slugs. */
export const DISTILL_MODEL_ENV = "CSAGENT_DISTILL_SUBAGENT_MODEL";

export function resolveDistillSubagentModel(): string {
  return process.env[DISTILL_MODEL_ENV]?.trim() || CURSOR_DISTILL_SUBAGENT_MODEL;
}

export class DistillModelError extends Error {
  readonly availableComposerModels: string[];
  constructor(requested: string, availableComposerModels: string[]) {
    super(
      `Distill subagent model "${requested}" is not available via Cursor SDK API. ` +
        `Composer models on this key: ${availableComposerModels.join(", ") || "(none)"}. ` +
        `Set ${DISTILL_MODEL_ENV} to override (required default: ${CURSOR_DISTILL_SUBAGENT_MODEL}).`
    );
    this.name = "DistillModelError";
    this.availableComposerModels = availableComposerModels;
  }
}

/** Fail fast before a long batch when the pinned model is absent from SDK API. */
export async function assertDistillSubagentModel(dir: string): Promise<string> {
  const model = resolveDistillSubagentModel();
  const { key } = resolveApiKey(dir);
  if (!key) {
    throw new DistillModelError(model, []);
  }
  let list: Array<{ id?: string }>;
  try {
    const mod = await import("@cursor/sdk");
    const Cursor = mod.Cursor as { models: { list: (opts: { apiKey: string }) => Promise<Array<{ id?: string }>> } };
    list = await Cursor.models.list({ apiKey: key });
  } catch {
    // Offline / SDK glitch — proceed; runPrompt will surface the error per transcript.
    return model;
  }
  const ids = list.map((m) => m.id).filter((id): id is string => Boolean(id?.trim()));
  if (ids.includes(model)) return model;
  const composer = ids.filter((id) => id.includes("composer"));
  throw new DistillModelError(model, composer);
}
