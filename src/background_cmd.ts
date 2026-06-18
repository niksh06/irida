/**
 * `csagent background pause|resume|status` — toggle autonomous cron activity.
 * Pausing leaves user-initiated paths (TUI, gateway replies, `cron run`) intact.
 */
import { EXIT, type ExitCode } from "./exit.js";
import { backgroundPauseState, setBackgroundPaused } from "./backgroundPause.js";

export interface BackgroundCmdOptions {
  dir?: string;
}

function printState(dir: string): void {
  const st = backgroundPauseState(dir);
  if (st.paused) {
    const bits = [st.source, st.reason, st.at].filter(Boolean).join(", ");
    console.log(`background: PAUSED (${bits}) — cron tick runs no jobs`);
  } else {
    console.log("background: active — cron tick runs due jobs");
  }
}

export function cmdBackground(argv: string[], opts: BackgroundCmdOptions = {}): ExitCode {
  const dir = opts.dir ?? process.cwd();
  const [sub, ...rest] = argv;
  switch (sub) {
    case "pause": {
      const reason = rest.join(" ").trim() || undefined;
      setBackgroundPaused(dir, true, reason);
      printState(dir);
      return EXIT.ok;
    }
    case "resume": {
      setBackgroundPaused(dir, false);
      const st = backgroundPauseState(dir);
      if (st.paused && st.source === "env") {
        console.log(
          "file flag cleared, but CSAGENT_PAUSE_BACKGROUND is still set — background stays PAUSED"
        );
        return EXIT.ok;
      }
      printState(dir);
      return EXIT.ok;
    }
    case undefined:
    case "status":
      printState(dir);
      return EXIT.ok;
    case "-h":
    case "--help":
    case "help":
      console.log(`Usage:
  csagent background status         show whether autonomous cron is paused
  csagent background pause [reason] pause all cron tick jobs (no token spend)
  csagent background resume         resume due cron jobs

Hard override: env CSAGENT_PAUSE_BACKGROUND=1 forces paused regardless of file.`);
      return EXIT.ok;
    default:
      console.error(`background: unknown subcommand '${sub}'\n\nRun: csagent background help`);
      return EXIT.usage;
  }
}
