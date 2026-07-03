/**
 * Standalone visual preview of the TUI mascot «Wisp».
 *
 * Cycles through every pet state (and every working activity) and animates the
 * frames right in the terminal, with the color roles mapped to ANSI colors —
 * no Ink/React needed.
 *
 * Run it:  npx tsx scripts/pet-preview.mts
 * Options: --once  render one frame of each state and exit (no animation)
 *          --slow  slower animation
 */
import {
  PET_WISP_FRAMES,
  petTerminalFrame,
  petTerminalLabel,
  type PetActivityKind,
  type PetColorRole,
} from "../src/petTerminal.js";
import type { PetState } from "../src/petState.js";

const RESET = "\x1b[0m";

/** Approximate the TUI theme color roles with ANSI escapes. */
function ansi(role: PetColorRole | undefined): string {
  switch (role) {
    case "accent":
      return "\x1b[38;5;213m"; // pink/magenta sparkles
    case "warn":
      return "\x1b[38;5;214m"; // amber — busy
    case "good":
      return "\x1b[38;5;78m"; // green — happy
    case "error":
      return "\x1b[38;5;203m"; // red — sad
    case "muted":
      return "\x1b[38;5;245m"; // dim grey
    case "primary":
    default:
      return "\x1b[38;5;117m"; // soft cyan — body
  }
}

function renderFrame(state: PetState, tick: number, activity?: PetActivityKind): string {
  const lines = petTerminalFrame(state, tick, activity);
  const body = lines
    .map((line) => line.parts.map((p) => `${ansi(p.c)}${p.t}${RESET}`).join(""))
    .join("\n");
  const label = `\x1b[2m${petTerminalLabel(state, activity)}${RESET}`;
  return `${body}\n${label}`;
}

const STATES: PetState[] = ["idle", "working", "happy", "sad", "sleep", "retry", "worried"];
const ACTIVITIES: PetActivityKind[] = ["read", "edit", "search", "shell", "mcp", "tool"];

const once = process.argv.includes("--once");
const slow = process.argv.includes("--slow");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clear = () => process.stdout.write("\x1b[2J\x1b[H");

async function main(): Promise<void> {
  if (once) {
    // Static dump: one frame of every state, side-by-side-ish in a list.
    for (const state of STATES) {
      console.log(`\n${"─".repeat(20)}  ${state}  ${"─".repeat(20)}`);
      console.log(renderFrame(state, 0));
    }
    return;
  }

  const frameMs = slow ? 600 : 280;
  const cyclesPerState = 3; // how many times to loop a state's animation

  // Build a playlist: each plain state, then working once per activity.
  const playlist: Array<{ state: PetState; activity?: PetActivityKind; label: string }> = [];
  for (const state of STATES) {
    if (state === "working") continue; // shown per-activity below
    playlist.push({ state, label: state });
  }
  for (const activity of ACTIVITIES) {
    playlist.push({ state: "working", activity, label: `working · ${activity}` });
  }

  process.stdout.write("\x1b[?25l"); // hide cursor
  try {
    // eslint-disable-next-line no-constant-condition
    for (;;) {
      for (const item of playlist) {
        const frameCount = PET_WISP_FRAMES[item.state].length;
        const ticks = Math.max(frameCount * cyclesPerState, 4);
        for (let tick = 0; tick < ticks; tick++) {
          clear();
          console.log(`  irida · wisp preview — \x1b[1m${item.label}\x1b[0m`);
          console.log("  (Ctrl+C to quit)\n");
          console.log(renderFrame(item.state, tick, item.activity));
          await sleep(frameMs);
        }
      }
    }
  } finally {
    process.stdout.write("\x1b[?25h\n"); // show cursor
  }
}

process.on("SIGINT", () => {
  process.stdout.write("\x1b[?25h\n");
  process.exit(0);
});

void main();
