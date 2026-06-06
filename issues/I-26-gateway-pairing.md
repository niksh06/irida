# I-26 — Gateway pairing lite

**Status:** done  
**Module:** `src/gatewayPairing.ts`, `src/gatewayConfig.ts`, `src/gatewayTelegram.ts`

## Problem

New Telegram chatIds blocked by allowlist with no onboarding path.

## Solution

- `gateway.pairing.json` — pending codes + approved list
- Unknown chat → pairing code message
- Allowed admin: `/approve <code>`

## Verify

```bash
# From non-allowlisted chat → pairing code
# From allowlisted chat: /approve ABCDEF
```
