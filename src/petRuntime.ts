/**
 * Pet runtime snapshot — JSON bus for overlay + gateway (I-97).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ActivityDetail } from "./host.js";
import { loadPetManifest, petAssetsReady, resolvePetAssetPath, resolvePetDir } from "./petAssets.js";
import {
  activityToolRunning,
  resolvePetState,
  type PetState,
  type PetTheme,
} from "./petState.js";

export const PET_STATE_FILE = join(".agent", "pet-state.json");

export interface PetStateSnapshot {
  version: 1;
  state: PetState;
  theme: PetTheme;
  assetPath: string | null;
  assetUrl: string | null;
  updatedAt: string;
  turnBusy: boolean;
  toolRunning: boolean;
  lastTurnOk?: boolean;
  lastTurnError?: boolean;
  label?: string;
}

export interface PetRuntimeOptions {
  dir: string;
  theme?: PetTheme;
}

export class PetRuntimeTracker {
  private readonly dir: string;
  private readonly theme: PetTheme;
  private readonly petDir: string | null;
  private turnBusy = false;
  private toolRunning = false;
  private lastTurnOk = false;
  private lastTurnError = false;
  private lastEventAtMs = Date.now();
  private lastLabel: string | undefined;

  constructor(opts: PetRuntimeOptions) {
    this.dir = opts.dir;
    this.theme = opts.theme ?? "light";
    this.petDir = resolvePetDir(opts.dir);
  }

  get enabled(): boolean {
    return this.petDir != null && petAssetsReady(this.petDir);
  }

  beginTurn(): void {
    if (!this.enabled) return;
    this.turnBusy = true;
    this.toolRunning = false;
    this.lastTurnOk = false;
    this.lastTurnError = false;
    this.lastEventAtMs = Date.now();
    this.persist();
  }

  onActivity(activity: ActivityDetail): void {
    if (!this.enabled) return;
    this.lastEventAtMs = Date.now();
    this.lastLabel = activity.toolName ?? activity.label;
    if (activityToolRunning(activity)) this.toolRunning = true;
    if (activity.phase === "result" && activity.status === "error") {
      this.lastTurnError = true;
    }
    this.persist();
  }

  endTurn(ok: boolean): void {
    if (!this.enabled) return;
    this.turnBusy = false;
    this.toolRunning = false;
    this.lastTurnOk = ok;
    this.lastTurnError = !ok;
    this.lastEventAtMs = Date.now();
    this.persist();
  }

  touchIdle(): void {
    if (!this.enabled) return;
    this.turnBusy = false;
    this.toolRunning = false;
    this.lastEventAtMs = Date.now();
    this.persist();
  }

  snapshot(nowMs = Date.now()): PetStateSnapshot | null {
    if (!this.petDir) return null;
    const state = resolvePetState({
      turnBusy: this.turnBusy,
      toolRunning: this.toolRunning,
      lastTurnOk: this.lastTurnOk,
      lastTurnError: this.lastTurnError,
      lastEventAtMs: this.lastEventAtMs,
      nowMs,
    });
    const manifest = loadPetManifest(this.petDir);
    const assetPath = resolvePetAssetPath(this.petDir, state, this.theme, manifest);
    const assetUrl = assetPath ? pathToFileUrl(assetPath) : null;
    return {
      version: 1,
      state,
      theme: this.theme,
      assetPath,
      assetUrl,
      updatedAt: new Date(nowMs).toISOString(),
      turnBusy: this.turnBusy,
      toolRunning: this.toolRunning,
      lastTurnOk: this.lastTurnOk || undefined,
      lastTurnError: this.lastTurnError || undefined,
      label: this.lastLabel,
    };
  }

  persist(): void {
    const snap = this.snapshot();
    if (!snap) return;
    writePetStateSnapshot(this.dir, snap);
  }
}

export function pathToFileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

export function petStatePath(dir: string): string {
  return join(dir, PET_STATE_FILE);
}

export function writePetStateSnapshot(dir: string, snap: PetStateSnapshot): void {
  const path = petStatePath(dir);
  mkdirSync(join(dir, ".agent"), { recursive: true });
  writeFileSync(path, JSON.stringify(snap, null, 2) + "\n", "utf8");
}

export function readPetStateSnapshot(dir: string): PetStateSnapshot | null {
  const path = petStatePath(dir);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<PetStateSnapshot>;
    if (raw.version !== 1 || typeof raw.state !== "string") return null;
    const petDir = resolvePetDir(dir);
    if (!petDir) return raw as PetStateSnapshot;
    const theme = raw.theme === "dark" ? "dark" : "light";
    const state = resolvePetState({
      turnBusy: Boolean(raw.turnBusy),
      toolRunning: Boolean(raw.toolRunning),
      lastTurnOk: raw.lastTurnOk,
      lastTurnError: raw.lastTurnError,
      lastEventAtMs: raw.updatedAt ? Date.parse(raw.updatedAt) : Date.now(),
    });
    const assetPath =
      resolvePetAssetPath(petDir, state, theme) ??
      (typeof raw.assetPath === "string" ? raw.assetPath : null);
    return {
      version: 1,
      state,
      theme,
      assetPath,
      assetUrl: assetPath ? pathToFileUrl(assetPath) : null,
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
      turnBusy: Boolean(raw.turnBusy),
      toolRunning: Boolean(raw.toolRunning),
      lastTurnOk: raw.lastTurnOk,
      lastTurnError: raw.lastTurnError,
      label: raw.label,
    };
  } catch {
    return null;
  }
}
