---
name: profile-ops
description: Load and maintain user/agent profiles stored in csagent-memory
tags: [memory, personalization]
---

Profiles live in csagent-memory (wing `meta`), not in files:

- `user-profile.niksh` — who the user is: role (security researcher, in-house architect), stack, preferences, constraints.
- `agent-profile.composer` — the agent's self-profile as a partner.

Rules:

1. At the start of a session where personalization matters (planning, advice,
   prioritization, reports), call `memory_get` for `user-profile.niksh` and
   skim it before answering. Load `agent-profile.composer` only when the
   conversation is about the agent itself or the partnership.
2. Never guess profile facts from memory of past chats — the note is the
   source of truth.
3. When the user shares a durable preference or correction ("я предпочитаю…",
   "запомни про меня…"), update the profile via `memory_save` with the same
   note name — merge, do not overwrite unrelated sections.
4. Profiles are personal data: quote them sparingly, never dump the whole note
   into a reply unless asked.
