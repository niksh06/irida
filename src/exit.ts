/**
 * Exit-code policy (issue 001, revised 2026-05-29 to BSD sysexits(3)).
 *   0   EX_OK       — run finished.
 *   64  EX_USAGE    — bad CLI usage: missing/extra args, unknown command,
 *                     unknown session id, unknown skill.
 *   70  EX_SOFTWARE — executed run failed (status==="error") OR SDK
 *                     startup/resume failure (nothing or partial executed).
 *   77  EX_NOPERM   — unsafe destructive prompt denied / declined.
 *   78  EX_CONFIG   — config/auth problem: missing CURSOR_API_KEY, invalid
 *                     config, cloud runtime not allowed.
 *
 * `doctor` is a diagnostic and intentionally uses 0 (pass) / 1 (checks failed),
 * outside this policy.
 */
export const EXIT = {
  ok: 0,
  usage: 64,
  software: 70,
  noperm: 77,
  config: 78,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT] | 0 | 1;
