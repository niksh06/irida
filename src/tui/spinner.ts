/**
 * Shared TUI animation primitives — the same braille orbit + drifting sparkle
 * drive the thinking line and the tool-activity strip, so every "alive" surface
 * (mascot, thinking, activity) pulses in one visual language off `petClock`.
 * Pure functions of an integer tick; both glyph sets are single display cells.
 */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const WAVE = ["✦ · ·", "· ✦ ·", "· · ✦", "· ✦ ·"] as const;

const wrap = (tick: number, n: number) => ((Math.trunc(tick) % n) + n) % n;

/** A smooth 10-frame braille orbit for any integer tick (handles negatives). */
export function brailleSpinner(tick: number): string {
  return SPINNER[wrap(tick, SPINNER.length)]!;
}

/** A sparkle that drifts back and forth — Wisp's aura language. */
export function driftWave(tick: number): string {
  return WAVE[wrap(tick, WAVE.length)]!;
}
