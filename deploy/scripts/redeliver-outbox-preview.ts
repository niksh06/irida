#!/usr/bin/env npx tsx
/** One-off: redeliver truncated preview for a stuck gateway reply (post-mortem 2026-06-13). */
import pg from "pg";
import { telegramSendLongMessage } from "../../src/gatewayTelegram.js";
import { resolveTelegramBotToken } from "../../src/credentials.js";

const dir = process.env.CSGENT_ROOT || process.cwd();
const chatId = process.argv[2] || "1890281140";
const runId = process.argv[3] || "run_0746d0b4";

async function main() {
  const token = resolveTelegramBotToken(dir, "TELEGRAM_BOT_TOKEN").value;
  const dbUrl = process.env.CSGENT_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("CSAGENT_DATABASE_URL unset");
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  const r = await client.query("SELECT result_preview FROM runs WHERE id = $1", [runId]);
  await client.end();
  const preview = r.rows[0]?.result_preview as string | undefined;
  if (!preview) throw new Error(`no result_preview for ${runId}`);

  const header =
    "📬 **Отложенная доставка** (fix 2026-06-14)\n\n" +
    "Ответ от **2026-06-13 ~14:18** не дошёл в Telegram: `message is too long`. " +
    "Fix применён (rich→multipart + outbox downgrade).\n\n" +
    "Полный текст (5408 chars) в outbox не сохранился — ниже **preview из store** " +
    `(${preview.length} chars). Повтори вопрос для полного ответа.\n\n---\n\n`;
  const text = header + preview;
  const n = await telegramSendLongMessage(token, chatId, text, fetch, { format: "plain" });
  console.log(`delivered ${n} part(s) to chat ${chatId}, total ${text.length} chars`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
