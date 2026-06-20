/**
 * Pet asset manifest + path resolution (I-97).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { iridaRoot } from "./env.js";
import type { PetState, PetTheme } from "./petState.js";

export const PET_MANIFEST_REL = join("deploy", "assets", "pet", "manifest.json");

export interface PetManifest {
  version: number;
  targetWidth?: number;
  workingGif?: {
    env?: string;
    relative?: string;
    darkRelative?: string;
  };
  build?: {
    outputLight?: string;
    outputDark?: string;
  };
}

export function petDirCandidates(repoOrHome: string): string[] {
  const out: string[] = [];
  const root = iridaRoot();
  if (root) out.push(join(root, "deploy", "assets", "pet"));
  out.push(join(repoOrHome, "deploy", "assets", "pet"));
  if (repoOrHome !== process.cwd()) {
    out.push(join(process.cwd(), "deploy", "assets", "pet"));
  }
  return [...new Set(out.map((p) => resolve(p)))];
}

export function resolvePetDir(repoOrHome: string): string | null {
  for (const dir of petDirCandidates(repoOrHome)) {
    if (existsSync(join(dir, "manifest.json"))) return dir;
  }
  return null;
}

export function loadPetManifest(petDir: string): PetManifest {
  const raw = JSON.parse(readFileSync(join(petDir, "manifest.json"), "utf8")) as PetManifest;
  return raw;
}

function distThemeDir(manifest: PetManifest, theme: PetTheme): string {
  const rel = manifest.build?.outputLight ?? "dist/light";
  if (theme === "dark") {
    return manifest.build?.outputDark ?? "dist/dark";
  }
  return rel;
}

function staticAssetBasename(state: PetState): string {
  return state === "working" ? "working.gif" : `${state}.png`;
}

/** Prefer built dist/ assets; fall back to source/ for local dev before build. */
export function resolvePetAssetPath(
  petDir: string,
  state: PetState,
  theme: PetTheme,
  manifest?: PetManifest
): string | null {
  const m = manifest ?? loadPetManifest(petDir);
  const basename = staticAssetBasename(state);
  const distPath = join(petDir, distThemeDir(m, theme), basename);
  if (existsSync(distPath)) return distPath;

  if (state === "working") {
    const spec = m.workingGif;
    const envRoot = spec?.env ? process.env[spec.env]?.trim() : undefined;
    const rel = theme === "dark" ? spec?.darkRelative ?? spec?.relative : spec?.relative;
    if (envRoot && rel) {
      const gif = resolve(envRoot, rel);
      if (existsSync(gif)) return gif;
    }
    return null;
  }

  const sourcePath = join(petDir, "source", basename.replace(".png", ".png"));
  if (existsSync(sourcePath)) return sourcePath;
  return null;
}

export function petAssetsReady(petDir: string): boolean {
  const idle = resolvePetAssetPath(petDir, "idle", "light");
  return idle != null;
}
