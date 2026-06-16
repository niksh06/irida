---
name: gateway-ops
description: Telegram gateway troubleshooting and safe Bot API usage for csagent. Use when editing gateway polling, channel posts, deleteMessage, or diagnosing inbound silence.
tags: [gateway, telegram, csagent]
---

## Inbound silent, outbound OK

1. **`getWebhookInfo`** — `allowed_updates` **must include `message`**. If only `channel_post`, private/group traffic never reaches `getUpdates`.
2. Reset: call `getUpdates` with the full list from `TELEGRAM_GATEWAY_ALLOWED_UPDATES` in `src/gatewayTelegram.ts` (or restart gateway after I-84+ deploy).
3. Verify: `csagent doctor` row `telegram allowed_updates`; `csagent gateway status` same row.
4. Runbook: `deploy/PERSONAL-OPS.md` · postmortem `Reports/analysis/postmortem-gateway-telegram-inbound-silent-2026-06-17.md`

## Bot API rules for agents

- **Never** call `getUpdates` or `setWebhook` with a **narrow** `allowed_updates` (e.g. only `channel_post`). The filter is **global** for the bot token.
- Prefer **csagent gateway** for polling — it always passes `TELEGRAM_GATEWAY_ALLOWED_UPDATES`.
- Channel ops (`deleteMessage`, post to `@channel`) use **chat_id of the channel** — they do not replace gateway polling config.
- Outbound `sendMessage` working does **not** prove inbound polling works.

## Groups

- Privacy mode: bot may need `/cmd@BotUsername`.
- Slash parser strips `@suffix` — use standard csagent commands (`/status`, `/help`, …).

## Do not

- Revoke bot token in BotFather unless intentional — breaks all Telegram surfaces until `csagent auth telegram login`.
- Run a second poller (Hermes, manual `getUpdates`) on the same token — 409 conflict or stolen updates.
