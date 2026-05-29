/**
 * P0 exit-code policy (issue 001).
 *   0 — success: run finished.
 *   1 — startup/config/auth failure: nothing executed.
 *   2 — executed run failed (SDK result.status === "error").
 *   3 — unsafe prompt confirmation declined (wired in safety slice 006).
 */
export const EXIT = {
  ok: 0,
  startup: 1,
  runError: 2,
  unsafe: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
