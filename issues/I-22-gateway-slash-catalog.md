# I-22 — Gateway slash catalog (csagent-branded)

**Status:** done  
**Module:** `src/gatewaySlash.ts`, `src/gatewayRouter.ts`, `src/gatewayTelegram.ts`

## Problem

Telegram bot reused Hermes command menu and partial handlers. Users expected csagent catalog, not `COMMAND_REGISTRY`.

## Solution

- `GATEWAY_SLASH_COMMANDS`: `/help`, `/new`, `/status`, `/doctor`, `/memory`, `/sessions`, `/skills`, `/approve`
- Router handles slash before LLM turn; `/new` resets peer session
- `syncTelegramBotCommands` → `setMyCommands` on gateway start (3 scopes)

## Verify

```bash
csagent gateway run --adapter telegram   # or launchd restart
# Telegram: /help matches «/» menu (8 commands)
grep setMyCommands ~/.csagent/logs/gateway.log
```
