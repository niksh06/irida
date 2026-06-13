/**
 * Markdown → Telegram HTML (I-37). HTML parse_mode needs only &/</> escaping —
 * far safer than MarkdownV2's escape-everything rules. Callers fall back to
 * plain text when the API rejects parsing.
 *
 * Prefer `sendRichMessage` with native markdown when available (Bot API 10.1+);
 * this converter is the HTML fallback.
 */

export type TelegramMessageFormat = "rich" | "html" | "plain";

export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface Slot {
  token: string;
  html: string;
}

function applyInlineTelegramHtml(out: string): string {
  out = out.replace(/`([^`\n]+)`/g, (_m, body: string) => `<code>${body}</code>`);
  out = out.replace(/\*\*([^*\n][^*]*?)\*\*/g, (_m, body: string) => `<b>${body}</b>`);
  out = out.replace(/~~([^~\n]+?)~~/g, (_m, body: string) => `<s>${body}</s>`);
  out = out.replace(/\|\|([^|\n]+?)\|\|/g, (_m, body: string) => `<tg-spoiler>${body}</tg-spoiler>`);
  out = out.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, (_m, body: string) => `<i>${body}</i>`);
  out = out.replace(/(?<!_)_([^_\n]+?)_(?!_)/g, (_m, body: string) => `<i>${body}</i>`);
  out = out.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_m, label: string, url: string) => `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`
  );
  return out;
}

/** Convert common agent markdown to Telegram HTML (sendMessage parse_mode fallback). */
export function formatTelegramHtml(text: string): string {
  const slots: Slot[] = [];
  let out = text;

  // Blockquotes before escaping so `>` lines are recognized.
  out = out.replace(/(?:^|\n)((?:>[^\n]*(?:\n|$))+)/g, (_m, block: string) => {
    const inner = block.replace(/^>\s?/gm, "").replace(/\n$/, "");
    const token = `\u0000Q${slots.length}\u0000`;
    const body = escapeTelegramHtml(inner);
    slots.push({ token, html: `<blockquote>${applyInlineTelegramHtml(body)}</blockquote>` });
    return `\n${token}`;
  });

  // Fenced blocks — language class when Bot API supports syntax highlighting.
  out = out.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_m, lang: string, body: string) => {
    const token = `\u0000F${slots.length}\u0000`;
    const escaped = escapeTelegramHtml(body.replace(/\n$/, ""));
    const html = lang.trim()
      ? `<pre><code class="language-${escapeTelegramHtml(lang.trim())}">${escaped}</code></pre>`
      : `<pre>${escaped}</pre>`;
    slots.push({ token, html });
    return token;
  });

  out = escapeTelegramHtml(out);
  out = applyInlineTelegramHtml(out);

  for (const s of slots) out = out.replace(s.token, s.html);
  return out;
}

/** True when conversion produced any HTML markup worth sending with parse_mode. */
export function telegramHtmlDiffers(plain: string, html: string): boolean {
  return html !== escapeTelegramHtml(plain);
}
