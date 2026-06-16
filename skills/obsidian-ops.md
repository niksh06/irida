---
name: obsidian-ops
description: Read, search, create, and edit Markdown notes in the Obsidian vault via filesystem tools (not Tolaria MCP)
tags: [obsidian, notes, vault, csagent]
---

Obsidian vault work is **filesystem-first**. Tolaria MCP is read-only — use repo/vault file tools for writes.

## Vault path

Resolve once per task; never pass unresolved `$OBSIDIAN_VAULT_PATH` to tools.

1. `OBSIDIAN_VAULT_PATH` from the environment (`~/.csagent/csagent.env` or shell).
2. If unset, ask the user for the vault path (must be absolute).
3. All paths must be **absolute**; vault names may contain spaces.

## vs `memory-ops` (csagent-memory)

| Store | Use for |
|-------|---------|
| **kb-ops** | Technology reference KB (`$CSAGENT_HOME/knowledge-space`, git) |
| **csagent memory** (`memory_*` MCP) | Agent durable notes, TParser context, "remember for next turn" |
| **Obsidian vault** (this skill) | User PKM, journals, LLM wiki, handoff markdown |

Do not duplicate the same content in both unless the user asks. Prefer **memory** for operational agent state; prefer **vault** for human-facing notes.

**LLM wiki pattern:** compounding interlinked notes under `vault/wiki/` (raw → compile → query). See [docs/MEMORY-GOVERNANCE.md](../docs/MEMORY-GOVERNANCE.md) §4. Operational decisions promoted to PG only when gateway must recall them without opening the vault.

## Obsidian CLI (optional)

When Obsidian 1.12+ CLI is enabled (`obsidian search`, `read`, `backlinks`, `orphans`). App must be running. Example:

```bash
obsidian vault="$OBSIDIAN_VAULT_PATH" search:context query="topic" limit=5
```

Prefer filesystem `Grep`/`Read` when CLI is unavailable; use CLI for backlink/orphan lint at scale.

## Read

- Single note → `Read` on `<vault>/<relative-path>.md`
- Discover files → `Glob` e.g. `**/*.md` under a vault subfolder
- Content search → `Grep` with path scoped to the vault; restrict to `*.md` when possible

Prefer these over raw `cat`/`find` — clearer errors and line numbers.

## Create

- New note → `Write` with full markdown body at `<vault>/Folder/Title.md`
- Use YAML frontmatter when the vault expects it (`title`, `tags`, `date`)
- Link related notes with Obsidian wikilinks: `[[Note Title]]` or `[[path/note|alias]]`

## Edit

- Small change → `StrReplace` on the note path (stable unique anchor)
- Append a section → read first, then replace trailing block or append via `StrReplace` on a heading anchor
- Large restructure → `Write` full file after reading current content

## Search patterns

- By filename: `Glob` with pattern under vault root or subfolder
- By keyword: `Grep` across `*.md` in vault
- Before creating a note: search to avoid duplicates and to pick correct wikilink targets

## Scheduled jobs

- **TParser bi-hourly / digest cron:** do **not** write Obsidian files unless the job prompt explicitly allows it (evening/handoff jobs only).
- When writing from cron: one note per run, idempotent filename (date slug), no overwrite without reading first.

## Do not

- Use Tolaria MCP for create/update (read-only).
- Use `memory_save` for content that belongs in the user's Obsidian vault (unless user wants a mirror).
- Invent vault paths or note titles — search or list first.
- Commit vault secrets (.env tokens, credentials) into markdown notes.

## Enable

Add to `gateway.json` or cron job `skills` when Telegram/cron should touch the vault:

```json
"skills": ["memory-ops", "obsidian-ops"]
```

Set vault path in `~/.csagent/csagent.env`:

```bash
export OBSIDIAN_VAULT_PATH="/absolute/path/to/ForNotes"
```

Re-run `deploy/install-launchd.sh` after changing `csagent.env` so gateway/cron inherit the variable.
