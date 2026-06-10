/**
 * Keep gateway alive on stray SDK/network promise failures (Telegram long-poll process).
 */
import { redact } from "./redact.js";
import { emitServiceLog } from "./serviceLog.js";

let installed = false;

export function installGatewayProcessGuards(): void {
  if (installed) return;
  installed = true;

  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    emitServiceLog(`[gateway] unhandledRejection (kept alive): ${redact(msg)}`, "error");
  });

  process.on("uncaughtException", (err) => {
    // Node state is undefined after a sync throw — exit non-zero and let
    // launchd (KeepAlive SuccessfulExit=false) restart the gateway clean.
    emitServiceLog(`[gateway] uncaughtException (exiting for restart): ${redact(err.message)}`, "error");
    process.exit(1);
  });
}

/** @internal tests */
export function resetGatewayProcessGuardsForTests(): void {
  installed = false;
}
