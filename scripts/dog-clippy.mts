/**
 * Terminal "Clippy" prototype for the blue dog (tparser-dog-butterfly).
 *
 * Renders the real half-block dog art from deploy/assets/pet/terminal/<theme>
 * next to a Clippy-style speech bubble that reacts to the pet state. This is an
 * evaluation prototype for the eventual desktop overlay — it does NOT touch the
 * live TUI.
 *
 * Run:  npm run dog   (or: npx tsx scripts/dog-clippy.mts)
 * Opts: --once   one frame per scene, then exit
 *       --slow   slower animation
 *       --dark   use the dark-theme art
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

type Seg = { t: string; f?: string | null; b?: string | null };
type Frame = { lines: Seg[][] };
type Art = { version: number; width?: number; frames: Frame[] };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const RESET = "\x1b[0m";

const dark = process.argv.includes("--dark");
const once = process.argv.includes("--once");
const slow = process.argv.includes("--slow");
const THEME = dark ? "dark" : "light";

type State = "idle" | "working" | "happy" | "sad" | "sleep";
const STATES: State[] = ["idle", "working", "happy", "sad", "sleep"];

/** Clippy-style line the dog "says" per state. */
const TIPS: Record<State, string> = {
  idle: "Привет! Я Пёс. Чем займёмся?",
  working: "Ловлю баг, как бабочку… 🦋 секунду.",
  happy: "Готово! Ход прошёл чисто. 🎉",
  sad: "Хм, тут ошибка. Посмотрим вместе?",
  sleep: "Zzz… разбуди, когда понадоблюсь.",
};

function loadArt(state: State): Art {
  const path = join(ROOT, "deploy/assets/pet/terminal", THEME, `${state}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Art;
}

function hexToAnsi(hex: string, bg: boolean): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[${bg ? 48 : 38};2;${r};${g};${b}m`;
}

function segWidth(line: Seg[]): number {
  return line.reduce((n, s) => n + [...s.t].length, 0);
}

/**
 * Render one frame to ANSI strings, padded to `width` and bottom-aligned to
 * `height` (blank rows prepended) so shorter chase frames don't jump around.
 */
function renderFrame(art: Art, frameIdx: number, width: number, height: number): string[] {
  const frame = art.frames[frameIdx % art.frames.length]!;
  const out: string[] = [];
  for (const line of frame.lines) {
    let s = "";
    for (const seg of line) {
      const codes = (seg.f ? hexToAnsi(seg.f, false) : "") + (seg.b ? hexToAnsi(seg.b, true) : "");
      s += codes ? `${codes}${seg.t}${RESET}` : seg.t;
    }
    const pad = Math.max(0, width - segWidth(line));
    out.push(s + " ".repeat(pad));
  }
  const blank = " ".repeat(width);
  while (out.length < height) out.unshift(blank);
  return out.slice(0, height);
}

/** Wrap text to <= maxInner visible columns. */
function wrap(text: string, maxInner: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if ([...next].length > maxInner && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const DIM = "\x1b[2m";
const BUBBLE = "\x1b[38;5;252m";

/** A rounded speech bubble (array of plain+ANSI rows). */
function bubble(text: string, maxInner = 28): string[] {
  const body = wrap(text, maxInner);
  const inner = Math.max(...body.map((l) => [...l].length));
  const top = `${BUBBLE}╭${"─".repeat(inner + 2)}╮${RESET}`;
  const bot = `${BUBBLE}╰${"─".repeat(inner + 2)}╯${RESET}`;
  const rows = body.map((l) => {
    const padded = l + " ".repeat(inner - [...l].length);
    return `${BUBBLE}│${RESET} ${padded} ${BUBBLE}│${RESET}`;
  });
  return [top, ...rows, bot];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clear = () => process.stdout.write("\x1b[2J\x1b[H");

/** Compose dog (left) + bubble (right), with a tail pointing at the dog. */
function scene(dog: string[], width: number, bub: string[]): string {
  const rows = Math.max(dog.length, bub.length);
  const dogTop = Math.floor((rows - dog.length) / 2);
  const bubTop = Math.floor((rows - bub.length) / 2);
  const tailRow = bubTop + Math.floor(bub.length / 2);
  const blankDog = " ".repeat(width);
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    const left = i >= dogTop && i < dogTop + dog.length ? dog[i - dogTop]! : blankDog;
    const gap = i === tailRow ? `${BUBBLE}◀─${RESET}` : "  ";
    const right = i >= bubTop && i < bubTop + bub.length ? bub[i - bubTop]! : "";
    lines.push(`  ${left} ${gap}${right}`);
  }
  return lines.join("\n");
}

const art: Record<State, Art> = Object.fromEntries(
  STATES.map((s) => [s, loadArt(s)])
) as Record<State, Art>;

function stateHeight(state: State): number {
  return Math.max(...art[state].frames.map((f) => f.lines.length));
}

async function main(): Promise<void> {
  const width = art.idle.width ?? 22;

  if (once) {
    for (const state of STATES) {
      const dog = renderFrame(art[state], 0, width, stateHeight(state));
      console.log(`\n${DIM}── ${state} ──${RESET}`);
      console.log(scene(dog, width, bubble(TIPS[state])));
    }
    return;
  }

  const frameMs = slow ? 650 : 320;
  const dwell = 6; // animation ticks per scene
  process.stdout.write("\x1b[?25l");
  const restore = () => process.stdout.write("\x1b[?25h\n");
  process.on("SIGINT", () => {
    restore();
    process.exit(0);
  });
  try {
    for (;;) {
      for (const state of STATES) {
        const height = stateHeight(state);
        const bub = bubble(TIPS[state]);
        const ticks = Math.max(art[state].frames.length * 2, dwell);
        for (let t = 0; t < ticks; t++) {
          clear();
          console.log(`  ${DIM}csagent · dog-clippy prototype (${THEME}) — Ctrl+C to quit${RESET}\n`);
          console.log(scene(renderFrame(art[state], t, width, height), width, bub));
          await sleep(frameMs);
        }
      }
    }
  } finally {
    restore();
  }
}

void main();
