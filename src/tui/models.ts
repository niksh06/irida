import { loadConfig } from "../config.js";

/** Default model ids for TUI picker (override via CSAGENT_MODELS env). */
export const DEFAULT_MODELS = ["composer-2.5", "composer-2", "claude-4-sonnet", "gpt-5.4"];

export function listPickerModels(dir: string = process.cwd()): string[] {
  const cfg = loadConfig(dir);
  const fromEnv = (process.env.CSAGENT_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const base = fromEnv.length ? fromEnv : DEFAULT_MODELS;
  const set = new Set<string>([cfg.model, ...base]);
  return [...set];
}
