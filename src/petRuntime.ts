/**
 * Pet runtime snapshot — JSON bus for overlay + gateway (I-97).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ActivityDetail } from "./host.js";
import { loadPetManifest, resolvePetAssetPath, resolvePetDir } from "./petAssets.js";
import {
  activityToolRunning,
  resolvePetState,
  type PetState,
  type PetTheme,
} from "./petState.js";
import { classifyPetActivity, type PetActivityKind } from "./petTerminal.js";

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
  /** Active tool bucket while working — drives the overlay "thought" glyph. */
  activity?: PetActivityKind;
  /** Lifetime XP (I-148): +1 per ok turn, +3 bonus each 10-turn clean streak. */
  xp?: number;
  /** Consecutive ok turns (feeds the streak bonus; resets on error). */
  streakOk?: number;
  /** Last overload-retry moment (I-150) — consumers window it via PET_RETRY_MS. */
  retryAtMs?: number;
  /** Store/memory degraded (I-150) — sticky until a turn passes with no degrade. */
  storeDegraded?: boolean;
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
  private lastActivity: PetActivityKind | undefined;
  private xp = 0;
  private streakOk = 0;
  private lastRetryAtMs: number | undefined;
  private storeDegraded = false;
  private degradedThisTurn = false;

  constructor(opts: PetRuntimeOptions) {
    this.dir = opts.dir;
    this.theme = opts.theme ?? "light";
    // Legacy PNG pipeline is optional — the Wisp overlay renders glyph frames
    // from the snapshot alone, so the tracker works with no pet assets at all.
    this.petDir = resolvePetDir(opts.dir);
    // XP is lifetime progress — seed from the existing snapshot so restarts
    // (and fresh sessions in the same dir) keep the pet's earned level.
    const prev = readPetStateSnapshot(opts.dir);
    this.xp = prev?.xp ?? 0;
    this.streakOk = prev?.streakOk ?? 0;
  }

  beginTurn(): void {
    this.turnBusy = true;
    this.toolRunning = false;
    this.lastTurnOk = false;
    this.lastTurnError = false;
    this.lastActivity = undefined;
    this.degradedThisTurn = false;
    this.lastEventAtMs = Date.now();
    this.persist();
  }

  /** Overload retry hiccup (I-150) — consumers window it via PET_RETRY_MS. */
  noteRetry(): void {
    this.lastRetryAtMs = Date.now();
    this.lastEventAtMs = this.lastRetryAtMs;
    this.persist();
  }

  /** Store/memory degraded mid-turn (I-150) — worry sticks until a CLEAN turn. */
  noteStoreDegraded(): void {
    this.storeDegraded = true;
    this.degradedThisTurn = true;
    this.persist();
  }

  onActivity(activity: ActivityDetail): void {
    this.lastEventAtMs = Date.now();
    this.lastLabel = activity.toolName ?? activity.label;
    this.lastActivity = classifyPetActivity(activity.toolName, activity.kind);
    if (activityToolRunning(activity)) this.toolRunning = true;
    if (activity.phase === "result" && activity.status === "error") {
      this.lastTurnError = true;
    }
    this.persist();
  }

  endTurn(ok: boolean): void {
    this.turnBusy = false;
    this.toolRunning = false;
    this.lastTurnOk = ok;
    this.lastTurnError = !ok;
    if (ok) {
      this.streakOk += 1;
      this.xp += 1 + (this.streakOk % 10 === 0 ? 3 : 0);
      // Only a turn that degraded NOTHING proves the store recovered — an ok
      // turn whose own persists failed must not wipe the worry it just raised.
      if (!this.degradedThisTurn) this.storeDegraded = false;
      // The hiccup belonged to this turn; it ended well (mirrors the TUI).
      this.lastRetryAtMs = undefined;
    } else {
      this.streakOk = 0;
    }
    this.lastEventAtMs = Date.now();
    this.persist();
  }

  touchIdle(): void {
    this.turnBusy = false;
    this.toolRunning = false;
    this.lastEventAtMs = Date.now();
    this.persist();
  }

  snapshot(nowMs = Date.now()): PetStateSnapshot | null {
    const state = resolvePetState({
      turnBusy: this.turnBusy,
      toolRunning: this.toolRunning,
      lastTurnOk: this.lastTurnOk,
      lastTurnError: this.lastTurnError,
      retryAtMs: this.lastRetryAtMs,
      storeDegraded: this.storeDegraded,
      lastEventAtMs: this.lastEventAtMs,
      nowMs,
    });
    const assetPath = this.petDir
      ? resolvePetAssetPath(this.petDir, state, this.theme, loadPetManifest(this.petDir))
      : null;
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
      activity: this.lastActivity,
      xp: this.xp,
      streakOk: this.streakOk,
      retryAtMs: this.lastRetryAtMs,
      storeDegraded: this.storeDegraded || undefined,
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
      retryAtMs: typeof raw.retryAtMs === "number" ? raw.retryAtMs : undefined,
      storeDegraded: Boolean(raw.storeDegraded),
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
      activity: raw.activity,
      xp: typeof raw.xp === "number" ? raw.xp : undefined,
      streakOk: typeof raw.streakOk === "number" ? raw.streakOk : undefined,
      retryAtMs: typeof raw.retryAtMs === "number" ? raw.retryAtMs : undefined,
      storeDegraded: raw.storeDegraded ? true : undefined,
    };
  } catch {
    return null;
  }
}
