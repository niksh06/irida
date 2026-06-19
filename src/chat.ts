/**
 * `csagent chat` — readline interactive session (issue 009).
 * Ink TUI: `csagent tui` (see tui/entry.tsx).
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { openChatSession, type ChatSessionOptions } from "./chatEngine.js";
import { SESSION_CHANNEL } from "./sessionChannel.js";
import { EXIT, type ExitCode } from "./exit.js";

export type ChatOptions = ChatSessionOptions & {
  /** Test/non-interactive driver: fixed input lines (no readline). */
  lines?: string[];
  /** Sink for assistant output when not using onAssistantDelta. */
  write?: (s: string) => void;
};

export async function cmdChat(opts: ChatOptions = {}): Promise<ExitCode> {
  const write = opts.write ?? ((s: string) => stdout.write(s));
  const scripted = Array.isArray(opts.lines);
  const interactive = opts.interactive ?? (!scripted && stdin.isTTY === true);

  const rl = scripted ? null : createInterface({ input: stdin, output: stdout });
  const confirm =
    opts.confirm ??
    (async (reason) => {
      if (!rl) return false;
      const a = (await rl.question(`⚠ ${reason}. Proceed? [y/N] `)).trim().toLowerCase();
      return a === "y" || a === "yes";
    });

  const opened = await openChatSession({
    ...opts,
    channel: opts.channel ?? SESSION_CHANNEL.cli,
    interactive,
    confirm,
    onAssistantDelta: opts.onAssistantDelta ?? ((d) => write(d)),
    onLog: opts.onLog ?? ((line) => console.error(line)),
  });
  if (!opened.ok) {
    console.error("chat: " + opened.message);
    rl?.close();
    return opened.code;
  }

  const session = opened.session;
  const queued = [...(opts.lines ?? [])];
  const ask = async (): Promise<string | null> => {
    if (scripted) return queued.length ? (queued.shift() as string) : null;
    try {
      return await rl!.question("you> ");
    } catch {
      return null;
    }
  };

  let exitCode: ExitCode = EXIT.ok;
  try {
    for (;;) {
      const line = await ask();
      if (line === null) break;
      const msg = line.trim();
      if (!msg) continue;
      if (msg === "exit" || msg === "quit" || msg === ":q") break;

      const out = await session.sendTurn(msg);
      if (out.kind === "blocked") {
        console.error(`chat: blocked — ${out.reason}`);
        if (!interactive) {
          exitCode = EXIT.noperm;
          break;
        }
        continue;
      }
      if (out.kind === "error") {
        console.error("chat: " + out.message);
        if (out.fatal || out.runFailed) exitCode = EXIT.software;
        if (out.fatal) break;
        continue;
      }
      write("\n");
    }
  } finally {
    await session.close();
    rl?.close();
  }
  return exitCode;
}
