import { redact } from "./redact.js";

/** Best-effort detail from SDK run.wait() when status === "error". */
export function pickRunErrorDetail(res: unknown): string | null {
  if (res == null || typeof res !== "object") return null;
  const r = res as Record<string, unknown>;
  for (const key of ["error", "message", "detail", "reason"]) {
    const v = r[key];
    if (typeof v === "string" && v.trim()) return redact(v.trim().slice(0, 240));
  }
  if (typeof r.result === "string" && r.result.trim()) {
    return redact(r.result.trim().slice(0, 240));
  }
  return null;
}

export function formatRunErrorMessage(opts: {
  res: unknown;
  toolCalls: number;
  turnText: string;
}): { message: string; partialAssistantText?: string } {
  const res = opts.res as { id?: string };
  const parts: string[] = ["Agent run failed (SDK status=error)"];
  if (res?.id) parts.push(`run ${String(res.id).slice(0, 12)}`);
  if (opts.toolCalls > 0) parts.push(`${opts.toolCalls} tool call(s)`);

  const detail = pickRunErrorDetail(opts.res);
  if (detail) parts.push(detail);
  else {
    parts.push(
      "Common causes: shell/tool failure, step limit, or context overflow — retry with a narrower question or check /tools"
    );
  }

  const partial = opts.turnText.trim();
  return {
    message: parts.join(" · "),
    partialAssistantText: partial || undefined,
  };
}
