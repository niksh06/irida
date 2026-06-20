/**
 * `irida pet status` — read optional `.agent/pet-state.json` (debug).
 */
import { EXIT, type ExitCode } from "./exit.js";
import { iridaHome } from "./env.js";
import { petAssetsReady, petDirCandidates, resolvePetDir } from "./petAssets.js";
import { PetRuntimeTracker, readPetStateSnapshot } from "./petRuntime.js";

function resolveDir(): string {
  return iridaHome() ?? process.cwd();
}

export function cmdPetStatus(_args: string[]): ExitCode {
  const dir = resolveDir();
  const petDir = resolvePetDir(dir);
  if (!petDir) {
    console.error("pet: manifest not found — expected deploy/assets/pet/manifest.json under CSAGENT_ROOT");
    return EXIT.config;
  }
  if (!petAssetsReady(petDir)) {
    console.error("pet: assets missing — run: python3 deploy/scripts/build-pet-assets.py");
    console.error(`pet: searched: ${petDirCandidates(dir).join(", ")}`);
    return EXIT.config;
  }
  const snap = readPetStateSnapshot(dir) ?? new PetRuntimeTracker({ dir }).snapshot();
  if (!snap) {
    console.log("state idle (no snapshot yet)");
    return EXIT.ok;
  }
  console.log(`state ${snap.state}`);
  console.log(`theme ${snap.theme}`);
  if (snap.assetPath) console.log(`asset ${snap.assetPath}`);
  if (snap.label) console.log(`label ${snap.label}`);
  console.log(`updated ${snap.updatedAt}`);
  console.log("note: TUI shows the in-terminal pet; this file is optional/debug");
  return EXIT.ok;
}

export async function cmdPet(args: string[]): Promise<ExitCode> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "status":
      return cmdPetStatus(rest);
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(`Usage:
  irida pet status    optional snapshot from .agent/pet-state.json

The mascot lives in \`irida tui\` (terminal frames).`);
      return EXIT.ok;
    default:
      console.error(`unknown pet subcommand: ${sub}`);
      return EXIT.usage;
  }
}
