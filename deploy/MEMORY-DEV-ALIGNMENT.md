# Memory: выравнивание dev ↔ Telegram (операционный чеклист)

**Проблема:** Telegram gateway и локальный csagent могут видеть **разные заметки**, потому что читают разные `.agent/` и разные backend'ы (Postgres vs sqlite, files vs DB).

**Canonical runtime:** `CSAGENT_HOME=~/.csagent` + `CSAGENT_DATABASE_URL` (PG `:5435`).

См. issue **039** (локально: `docs/issues/039-unified-memory-root.md`, не в git) для кода.

---

## Диагностика (5 мин)

Запустите из **двух** контекстов и сравните вывод:

```bash
# A) Как Telegram (production home)
export CSAGENT_HOME=~/.csagent
export CSAGENT_DATABASE_URL=postgresql://csagent:csagent@127.0.0.1:5435/csagent
~/.csagent/csagent/scripts/csagent-run.sh memory list

# B) Как локальный dev (без env — типичная ловушка)
unset CSAGENT_HOME CSAGENT_DATABASE_URL
cd "/path/to/csagent"
npx tsx src/cli.ts memory list
```

| Симптом | Причина |
|---------|---------|
| Разные `NAME` в list | Разные store (PG vs local sqlite) |
| Telegram видит note X, dev — note Y | Заметки созданы в разных home |
| MCP `memory_search` ≠ `@memory:name` | DB vs файлы `.agent/memory/*.md` (split brain) |
| Cron в TParser видит третью копию | `cwd=TParser` → `TParser/.agent/memory/` |

Проверка файлов на диске:

```bash
ls -la ~/.csagent/.agent/memory/
ls -la "/path/to/csagent/.agent/memory/"
ls -la "/path/to/TParser/.agent/memory/"   # если есть
```

Проверка PG:

```bash
PGPASSWORD=csagent psql -h 127.0.0.1 -p 5435 -U csagent -d csagent \
  -c "SELECT name, wing, updated_at FROM memory_notes ORDER BY name;"
```

---

## Чеклист выравнивания

### 1. Зафиксировать canonical home

- [ ] **Production + Telegram:** `~/.csagent/.agent/` (уже так в launchd)
- [ ] **Dev:** не использовать repo `.agent/` как source of truth для memory
- [ ] В shell profile или `deploy/csagent.env.example` прописать:

```bash
export CSAGENT_HOME="$HOME/.csagent"
export CSAGENT_ROOT="$HOME/.csagent/csagent"
export CSAGENT_DATABASE_URL="postgresql://csagent:csagent@127.0.0.1:5435/csagent"
```

- [ ] Алиас для dev-сессий (опционально):

```bash
alias csagent-dev='CSAGENT_HOME=~/.csagent CSAGENT_DATABASE_URL=postgresql://csagent:csagent@127.0.0.1:5435/csagent ~/.csagent/csagent/scripts/csagent-run.sh'
```

### 2. Мигрировать локальные заметки в canonical store

Для каждой заметки только в `Downloads/Cursor agent/.agent/`:

```bash
export CSAGENT_HOME=~/.csagent
export CSAGENT_DATABASE_URL=postgresql://csagent:csagent@127.0.0.1:5435/csagent

# пример: pilot → canonical PG + mirror ~/.csagent/.agent/memory/
~/.csagent/csagent/scripts/csagent-run.sh memory add pilot-2026-06-01 --stdin \
  < "/path/to/csagent/.agent/memory/pilot-2026-06-01.md"
```

- [ ] `tparser-workflow` есть в PG / `~/.csagent/.agent/memory/`
- [ ] Локальные-only notes перенесены через `memory add`
- [ ] После миграции: `memory list` из dev **с env** совпадает с Telegram

### 3. TParser `.agent/memory` (если cron cwd=TParser)

TParser — **отдельный проект**; `@memory:tparser-workflow` в cron с `cwd=TParser` читает **файлы TParser**, не `~/.csagent`.

Выберите одну политику:

| Политика | Действие |
|----------|----------|
| **A. Symlink** | `TParser/.agent/memory/tparser-workflow.md` → `~/.csagent/.agent/memory/tparser-workflow.md` |
| **B. MCP-only в cron** | Prompt без `@memory:`; skill `memory-ops` → MCP читает PG |
| **C. Sync script** | Периодический `rsync` canonical → TParser (не ideal) |

Рекомендация: **B** (MCP-first уже в gateway) + **A** для `@memory:` в TParser cron, если нужен file inject.

- [ ] Политика выбрана и задокументирована в TParser `.agent/memory/` или cron prompt

### 4. Убрать путаницу в dev repo

- [ ] Не создавать новые notes в `Downloads/Cursor agent/.agent/memory/` без `CSAGENT_HOME`
- [ ] (Опционально) удалить или архивировать dev-only sqlite notes после миграции:

```bash
# только после подтверждения, что PG содержит те же notes
# rm "/path/to/csagent/.agent/memory/pilot-2026-06-01.md"
```

- [ ] `doctor` с canonical env: `~/.csagent/csagent/scripts/csagent-run.sh doctor`

### 5. Smoke: Telegram ↔ dev parity

- [ ] `memory list` (canonical env) = одни и те же имена
- [ ] В Telegram: «вызови memory_list и memory_search по tparser» → те же notes
- [ ] В dev TUI с canonical env: `@memory:tparser-workflow` или MCP → тот же текст
- [ ] Новая заметка через Telegram run (`memory_save`) видна в `memory list` локально

---

## Что **не** синхронизируется автоматически

| Артефакт | setup-home.sh |
|----------|---------------|
| `credentials.json`, `gateway.json` | да |
| `memory/*.md`, `memory_notes` в PG | **нет** |
| Локальный dev `.agent/state.sqlite` | **нет** |

После `setup-home.sh` memory нужно выравнивать **вручную** (этот чеклист) или через будущий `memory import-md` / issue 039.

---

## Быстрая справка: откуда что читает

| Путь | Telegram | Dev (без env) | Dev (с CSAGENT_HOME + PG) |
|------|----------|---------------|---------------------------|
| MCP `memory_*` | PG | local sqlite | PG |
| `@memory:name` | `~/.csagent/.agent/memory/` | repo `.agent/memory/` | `~/.csagent/.agent/memory/` |
| `memory onStart` | PG → file fallback | sqlite → file | PG → file |

---

## Stop condition

- [ ] Один `memory list` для gateway и dev (с canonical env)
- [ ] Нет «сюрпризных» notes только в repo `.agent/`
- [ ] TParser cron не тянет устаревший silo (symlink или MCP-only)
