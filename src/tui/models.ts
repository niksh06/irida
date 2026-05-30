import { loadConfig } from "../config.js";

/** Default model ids when SDK list is unavailable (override via CSAGENT_MODELS). */
export const DEFAULT_MODELS = ["composer-2.5", "composer-2", "claude-4-sonnet", "gpt-5.4"];

export type ModelListSource = "sdk" | "fallback";

export interface ModelListResult {
  models: string[];
  source: ModelListSource;
  error?: string;
}

export function mergePickerModels(configModel: string, ids: string[]): string[] {
  const set = new Set<string>();
  if (configModel.trim()) set.add(configModel.trim());
  for (const id of ids) {
    if (id.trim()) set.add(id.trim());
  }
  return [...set];
}

/** Static picker list (config + env or defaults). */
export function listPickerModelsFallback(dir: string = process.cwd()): string[] {
  const cfg = loadConfig(dir);
  const fromEnv = (process.env.CSAGENT_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const base = fromEnv.length ? fromEnv : DEFAULT_MODELS;
  return mergePickerModels(cfg.model, base);
}

/** @deprecated use listPickerModelsFallback or listPickerModelsFromSdk */
export function listPickerModels(dir: string = process.cwd()): string[] {
  return listPickerModelsFallback(dir);
}

/** Live model ids from Cursor SDK; falls back to static list on error. */
export async function listPickerModelsFromSdk(
  dir: string = process.cwd(),
  apiKey?: string
): Promise<ModelListResult> {
  const fallback = listPickerModelsFallback(dir);
  const key = (apiKey ?? process.env.CURSOR_API_KEY ?? "").trim();
  if (!key) {
    return { models: fallback, source: "fallback", error: "CURSOR_API_KEY not set" };
  }

  try {
    const { Cursor } = await import("@cursor/sdk");
    const list = await Cursor.models.list({ apiKey: key });
    const ids = list.map((m) => m.id).filter((id) => typeof id === "string" && id.trim());
    if (ids.length === 0) {
      return { models: fallback, source: "fallback", error: "SDK returned empty model list" };
    }
    const cfg = loadConfig(dir);
    return { models: mergePickerModels(cfg.model, ids), source: "sdk" };
  } catch (e) {
    return {
      models: fallback,
      source: "fallback",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
