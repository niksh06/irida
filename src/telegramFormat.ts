/**
 * Markdown → Telegram HTML (I-37). HTML parse_mode needs only &/</> escaping —
 * far safer than MarkdownV2's escape-everything rules. Callers fall back to
 * plain text when the API rejects parsing.
 */

export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface FenceSlot {
  token: string;
  html: string;
}

/** Convert common agent markdown (fences, `code`, **bold**, links) to Telegram HTML. */
export function formatTelegramHtml(text: string): string {
  const fences: FenceSlot[] = [];
  // Pull fenced blocks out first so inline rules never touch code.
  let out = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_m, _lang, body: string) => {
    const token = `\u0000F${fences.length}\u0000`;
    fences.push({ token, html: `<pre>${escapeTelegramHtml(body.replace(/\n$/, ""))}</pre>` });
    return token;
  });

  out = escapeTelegramHtml(out);
  out = out.replace(/`([^`\n]+)`/g, (_m, body: string) => `<code>${body}</code>`);
  out = out.replace(/\*\*([^*\n][^*]*?)\*\*/g, (_m, body: string) => `<b>${body}</b>`);
  out = out.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_m, label: string, url: string) => `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`
  );

  for (const f of fences) out = out.replace(f.token, f.html);
  return out;
}

/** True when conversion produced any HTML markup worth sending with parse_mode. */
export function telegramHtmlDiffers(plain: string, html: string): boolean {
  return html !== escapeTelegramHtml(plain);
}
