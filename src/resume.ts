/**
 * `irida resume <session-id> "<prompt>"` — one-shot CLI wrapper over the
 * shared chat session. Live resume, transcript replay, prompt composition,
 * safety, retries, rotation, and persistence all stay in `chatEngine`.
 */
import { openChatSession } from "./chatEngine.js";
import type { SdkCreateLike, SdkResumeLike } from "./host.js";
import { redact } from "./redact.js";
import { EXIT, type ExitCode } from "./exit.js";

type ResumeSdk = SdkResumeLike & SdkCreateLike;

export interface ResumeOptions {
  sdk?: ResumeSdk;
  dir?: string;
  write?: (s: string) => void;
  yesIUnderstand?: boolean;
  skills?: string[];
  /** Override engine.provider for this invocation (--engine). */
  engine?: string;
  /** Override engine.auth for this invocation (--auth). */
  auth?: string;
}

export async function cmdResume(
  sessionId: string,
  prompt: string,
  opts: ResumeOptions = {}
): Promise<ExitCode> {
  const dir = opts.dir ?? process.cwd();
  const write = opts.write ?? ((s: string) => process.stdout.write(s));

  if (!sessionId || !sessionId.trim()) {
    console.error("resume: a session id is required (see `irida sessions`)");
    return EXIT.usage;
  }
  if (!prompt || !prompt.trim()) {
    console.error('resume: a prompt is required, e.g. irida resume <id> "continue"');
    return EXIT.usage;
  }

  try {
    let wroteAssistant = false;
    const opened = await openChatSession({
      sdk: opts.sdk,
      dir,
      skills: opts.skills,
      yesIUnderstand: opts.yesIUnderstand,
      engine: opts.engine,
      auth: opts.auth,
      resumeSessionId: sessionId,
      preflightMessage: prompt,
      interactive: false,
      onAssistantDelta: (delta) => {
        wroteAssistant = true;
        write(delta);
      },
    });
    if (!opened.ok) {
      const hint = opened.code === EXIT.usage && opened.message === `session '${sessionId}' not found`
        ? " (see `irida sessions`)"
        : "";
      const message = opened.message.startsWith("resume failed: ")
        ? opened.message.slice("resume ".length)
        : opened.message;
      console.error(`resume: ${message}${hint}`);
      return opened.code;
    }

    const session = opened.session;
    try {
      if (session.connectMode === "replayed") {
        console.error("resume: live resume unavailable; replaying transcript into a fresh agent");
      }

      const outcome = await session.sendTurn(prompt);
      if (outcome.kind === "blocked") {
        console.error(`resume: blocked — ${outcome.reason}`);
        return EXIT.noperm;
      }
      if (outcome.kind === "error") {
        if (wroteAssistant) write("\n");
        console.error(`resume: failed: ${outcome.message}`);
        return outcome.exitCode ?? EXIT.software;
      }

      write("\n");
      console.error(
        `[resume] session=${sessionId} mode=${session.connectMode} status=${outcome.status}`
      );
      return EXIT.ok;
    } finally {
      await session.close();
    }
  } catch (e) {
    console.error("resume: failed: " + redact(e instanceof Error ? e.message : String(e)));
    return EXIT.software;
  }
}
