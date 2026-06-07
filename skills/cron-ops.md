# cron-ops

Use when the user asks to **schedule**, **remind later**, or **run something on a cron**.

## Tools (csagent-cron MCP)

1. **`cron_list`** — show existing jobs (optional `userOnly: true`).
2. **`cron_propose`** — draft a recurring job; always returns a confirm code.
3. **`cron_pending`** — list proposals awaiting approve.

## Workflow (required)

1. Clarify: **cron expression** (5-field, local time), **job id** (short slug), **prompt** (what the agent should do).
2. Call **`cron_propose`** with `{ id, cron, prompt, skills? }`.
3. Tell the user in Russian:

   > Подтверди: `/schedule approve <КОД>`

4. Do **not** claim the job is active until the user approves.

## Fallback (no MCP / user prefers slash)

`/schedule add 0 9 * * 1 weekly-inbox Summarize open tasks`

Other slash commands: `/schedule list`, `/schedule user`, `/schedule pending`, `/schedule remove user-<id>`.

## Rules

- User jobs get id prefix **`user-`** automatically.
- Cannot replace system jobs: `tparser-daily-digest`, `memory-curator-weekly`, etc.
- Max **10** user jobs.
- Prompts pass **cron prompt guard** — no injection patterns.
- Notify goes to **this Telegram chat** only.
