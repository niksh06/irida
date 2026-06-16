# csagent memory index

Canonical corpus map for agents (I-70). Load once per environment:

```bash
csagent memory add csagent-index --stdin --dir "$CSAGENT_HOME" < deploy/prompts/csagent-index.md
```

## Stores (do not confuse)

| Store | Skill | Use for |
|-------|-------|---------|
| Postgres memory | memory-ops | csagent ops, TParser, episodic, lessons, prefs |
| knowledge-space | kb-ops | Technology reference (834+ articles on disk) |
| Obsidian vault | obsidian-ops | Personal PKM |

## Search defaults

- **MCP-first:** autoRag OFF in prod — call `memory_search` when needed
- **Excluded wings:** `cursor-ide`, `secure`, `episodic` (use `includeArchive` / `includeEpisodic` for opt-in)
- **Episodic:** excluded from default ops search (I-73); `includeEpisodic: true` or CLI `--include-episodic`
- **Semantic:** prefer `semantic: true` for paraphrase; keyword for exact note names

## Key notes

| Name | Wing | Purpose |
|------|------|---------|
| tparser-workflow | default | TParser API, channels |
| reddit-feeds | default | RSS sub list |
| ops-gateway | default | Gateway/cron ops |
| agent-profile.composer | meta | Agent partnership |
| user-profile.niksh | meta | User prefs |

## Facts schema

- `cursor_lesson`: subject=`cursor_lesson`, predicate=lesson name, object=decision
- `user.niksh.*`: preferences
- **NEVER** subject or predicate starting with `--` (CLI flags are not facts)

## Do not

- Import KB articles into `memory_save` — use kb-ops on disk
- Enable autoRag without pilot sign-off (I-55)
- Bulk `@memory` inject — pull on demand only
- Write `seen_post` facts — digest dedup is window-only in prompts
