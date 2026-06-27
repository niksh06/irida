import { redact } from "./redact.js";
import { StartupError } from "./host.js";

export interface FormattedSdkError {
  message: string;
  errorKind: string;
  /** When true, TUI stays interactive (e.g. re-login and retry). */
  recoverable: boolean;
  /** When true, chatEngine may dispose agent, create fresh handle, and retry turn once. */
  rotatable: boolean;
}

type ConnectDetail = {
  error?: string;
  details?: { title?: string; detail?: string; isRetryable?: boolean };
};

function parseConnectDetails(e: unknown): ConnectDetail | null {
  if (e == null || typeof e !== "object") return null;
  const details = (e as { details?: unknown[] }).details;
  if (!Array.isArray(details) || details.length === 0) return null;
  for (const item of details) {
    if (item == null || typeof item !== "object") continue;
    const debug = (item as { debug?: ConnectDetail }).debug;
    if (debug && typeof debug === "object") return debug;
  }
  return null;
}

function isAuthError(e: unknown, detail: ConnectDetail | null): boolean {
  if (detail?.error === "ERROR_NOT_LOGGED_IN") return true;
  const code = (e as { code?: number }).code;
  return code === 16; // Code.Unauthenticated
}

/** Normalize Cursor SDK / ConnectRPC failures for CLI and TUI. */
export function formatSdkError(e: unknown): FormattedSdkError {
  if (e instanceof StartupError) {
    return { message: redact(e.message), errorKind: "startup", recoverable: false, rotatable: false };
  }

  const detail = parseConnectDetails(e);
  const auth = isAuthError(e, detail);

  if (detail?.details?.detail || detail?.details?.title) {
    const title = detail.details.title ?? "SDK error";
    const body = detail.details.detail ?? "";
    const message = auth
      ? `Authentication failed — ${body || "log in to Cursor and refresh CURSOR_API_KEY"}`
      : body ? `${title}: ${body}` : title;
    return {
      message: redact(message),
      errorKind: auth ? "auth" : detail.error ?? "sdk",
      recoverable: auth || detail.details.isRetryable === true,
      rotatable: !auth,
    };
  }

  const raw = e instanceof Error ? e.message : String(e);

  // Claude Agent SDK (claude-agent engine) surfaces failures as plain messages
  // from its bundled binary — no typed exceptions reach us, so auth failures are
  // classified heuristically. Marking them auth (recoverable, non-rotatable) stops
  // chat from rotating+retrying uselessly and gives the user a fix hint.
  if (!auth && /invalid api key|authentication|unauthorized|\bnot logged in\b|oauth|\/login|expired|credit balance/i.test(raw)) {
    return {
      message: redact(
        `Authentication failed — ${raw}. Set ANTHROPIC_API_KEY (auth=api-key), or run \`claude login\` / \`claude setup-token\` (auth=account).`
      ),
      errorKind: "auth",
      recoverable: true,
      rotatable: false,
    };
  }

  // Transient capacity/permission errors — account/subscription bursts return
  // `403 Request not allowed`, plus 429/529/503/overloaded. Rotating the session
  // NEVER helps (the fresh agent hits the same upstream state) and just sheds
  // context + spawns a session. Mark non-rotatable + recoverable so chat retries
  // in place instead. (I-127)
  if (!auth && /\b(403 request not allowed|429|503|529)\b|overloaded|rate.?limit|too many requests|service unavailable/i.test(raw)) {
    return {
      message: redact(`Upstream busy — ${raw}. Transient; retry shortly.`),
      errorKind: "overload",
      recoverable: true,
      rotatable: false,
    };
  }

  const message = redact(raw || "SDK request failed");
  return {
    message: auth ? `Authentication failed — ${message}` : message,
    errorKind: auth ? "auth" : "sdk",
    recoverable: auth,
    rotatable: !auth,
  };
}

/** True when sendTurn may rotate SDK agent and retry once (never for auth). */
export function isAgentRotatableError(e: unknown): boolean {
  return formatSdkError(e).rotatable;
}

/** Consume SDK run stream; swallow iterator cleanup rejections. */
export async function consumeRunStream(
  run: { stream?(): AsyncIterable<unknown> },
  onEvent: (ev: unknown) => void
): Promise<void> {
  if (typeof run.stream !== "function") return;
  const iter = run.stream()[Symbol.asyncIterator]();
  try {
    for (;;) {
      const step = await iter.next();
      if (step.done) break;
      onEvent(step.value);
    }
  } finally {
    try {
      await iter.return?.();
    } catch {
      // Connect end-stream races can reject iterator.return(); already handled via next().
    }
  }
}
