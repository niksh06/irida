---
name: kb-ops
description: Search the local HappyIn knowledge base (git markdown under IRIDA_HOME/knowledge-space) for technology best practices, flags, and gotchas
tags: [kb, knowledge-base, csagent, happyin]
---

The **technology reference KB** lives on disk — **not** in csagent-memory (Postgres). Do not `memory_search` or `memory import-md` for stack docs; use this skill.

## Root path

Resolve once per task:

1. `IRIDA_KB_ROOT` from env (`~/.irida/irida.env` or shell).
2. Else `$IRIDA_HOME/knowledge-space` when `IRIDA_HOME` is set.
3. Else ask the user for an absolute path.

Default prod layout: **`~/.irida/knowledge-space`** (git clone of [knowledge-space](https://github.com/AnastasiyaW/knowledge-space)).

Articles: **`{KB_ROOT}/docs/{domain}/{slug}.md`** (834+ articles, 26+ domains).

## vs other stores

| Store | Use for |
|-------|---------|
| **kb-ops** (this skill) | Kafka, Python, Docker, security, LLM agents, etc. — **canonical tech reference** |
| **memory-ops** | irida ops, TParser cron context, user prefs, episodic, cursor-lesson playbooks |
| **obsidian-ops** | Personal PKM vault (`OBSIDIAN_VAULT_PATH`), LLM wiki, journals |

Never duplicate KB articles into `memory_save`. Promote to memory only a **one-line ops decision** the gateway must recall offline (rare).

## Sync before read

**Every time** you open the KB for a task (before Grep/Read), refresh the clone:

```bash
git -C "$IRIDA_KB_ROOT" pull --ff-only
```

- Resolve `IRIDA_KB_ROOT` first (see Root path).
- **Fail open:** if pull fails (no network, merge conflict, not a git repo), say so briefly and read whatever is on disk — do not block the answer.
- Operator-only manual sync uses the same command; no irida CLI, no Postgres.

## Read workflow

When the user asks about a **technology**, configuration, gotchas, or best practices:

1. **Sync** — `git pull --ff-only` in `$IRIDA_KB_ROOT` (above).
2. **Orient** — read `{KB_ROOT}/docs/for-llm-agents.md` or `{KB_ROOT}/docs/index.md` if domain is unclear.
3. **Search** — `Grep` with path `{KB_ROOT}/docs`, pattern = keywords (domain name, tool, error). Prefer `*.md` only.
4. **Open** — `Read` the best-matching `{KB_ROOT}/docs/{domain}/{slug}.md`.
5. **Follow links** — resolve `[[wikilinks]]` (see below); do not invent flags or API shapes from training data when the KB has a article.

Quote technical facts from the article body (**English** in KB). Summarize for the user in Russian unless they ask otherwise.

## Wiki-links `[[...]]`

In sources, links are **`[[slug-or-title]]`** or **`[[domain/slug]]`**.

**Resolve locally:**

- Take the **last path segment** as stem (e.g. `[[kafka/consumer-configuration]]` → `consumer-configuration`).
- Find `{KB_ROOT}/docs/**/{stem}.md` (glob or grep by filename).
- If multiple matches, prefer the domain hinted in the link or from the current article's folder.

## Domain map (common)

| Domain folder | Topics |
|---------------|--------|
| `kafka/` | brokers, consumers, Connect, schema registry |
| `python/` | FastAPI, asyncio, typing |
| `security/` | TLS, AppSec, secrets |
| `devops/` | Docker, K8s, CI |
| `llm-agents/` | agents, tools, MCP |
| `llm-memory/` | RAG, vector stores |
| `data-engineering/` | SQL, pipelines |
| `web-frontend/` | React, Next.js |

Full domain list: `{KB_ROOT}/AGENTS.md` or `docs/index.md`.

## Article shape

KB articles are **dense reference** (code, configs, **Gotchas** section). Prefer the Gotchas section when debugging. Do not treat blog posts under `docs/blog/` as canonical unless the user asks.

## Do not

- Bulk-import KB into Postgres (`memory import-md`) — deprecated for prod.
- Use `memory_search` expecting HappyIn content (legacy import may exist; ignore for retrieval).
- Edit KB files unless the user explicitly asks to contribute upstream (see `{KB_ROOT}/AGENTS.md` PR flow).
- Commit secrets or machine-specific paths into KB articles.

## Validate links & format (when editing KB)

Run from **`$IRIDA_KB_ROOT`** after changing wiki-links or markdown paths. Same checks as CI (`.github/workflows/`).

**Required before commit/PR:**

```bash
python3 lint.link-check.py --strict    # all [[wikilinks]] + internal md links
python3 hooks/freshness_check.py --ci  # stats, llms.txt, wiki-link hooks
```

**CI reference** (for humans; agents use commands above):

| Workflow | What it runs |
|----------|----------------|
| `validate-article.yml` | Article shape (H1/H2, kebab-case, forbidden content) on changed `docs/**/*.md` |
| `validate-article.yml` → `link-check` job | `python lint.link-check.py --strict` |
| `validate-freshness.yml` | `python hooks/freshness_check.py --ci` |

After fixing links in articles, always re-run `lint.link-check.py --strict` until **All links OK**.

## Enable

Add to gateway or cron when the agent should use the KB (recommended for Telegram):

```json
"skills": ["memory-ops", "kb-ops", "browser-ops"]
```

Optional in `~/.irida/irida.env`:

```bash
export IRIDA_KB_ROOT="$IRIDA_HOME/knowledge-space"
```
