/**
 * Pet turn hooks — shared by CLI surfaces that persist pet-state.json (optional).
 */
import type { ActivityDetail } from "./host.js";
import type { TurnHooks } from "./chatEngine.js";
import { PetRuntimeTracker } from "./petRuntime.js";

export interface PetTurnBridgeOptions {
  dir: string;
  theme?: "light" | "dark";
  base?: TurnHooks;
}

/** Wrap a turn with pet state persistence to `.agent/pet-state.json`. */
export function wrapPetTurn(opts: PetTurnBridgeOptions): {
  hooks: TurnHooks;
  finish: (ok: boolean) => void;
} {
  const tracker = new PetRuntimeTracker({ dir: opts.dir, theme: opts.theme });
  if (!tracker.enabled) {
    return { hooks: opts.base ?? {}, finish: () => {} };
  }
  tracker.beginTurn();
  return {
    hooks: {
      ...opts.base,
      onActivity: (activity: ActivityDetail) => {
        tracker.onActivity(activity);
        opts.base?.onActivity?.(activity);
      },
    },
    finish: (ok: boolean) => tracker.endTurn(ok),
  };
}
