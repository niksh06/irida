# Phase 0 — закрытие (по порядку)

Коммит baseline: `d7e89cf` (deploy + `~/.csagent` + Telegram typing).

## Шаг 1 — Инфра (автомат / уже сделано)

- [x] `bash deploy/setup-home.sh` → `~/.csagent/csagent` + `~/.csagent/.agent`
- [x] `deploy/install-launchd.sh` → `ai.csagent.gateway` + `ai.csagent.cron-tick`
- [x] `csagent-run.sh doctor` — all checks passed
- [x] Gateway PID живой, лог без crash loop

Проверка:

```bash
launchctl list | grep csagent
~/.csagent/csagent/scripts/csagent-run.sh doctor
tail -5 ~/.csagent/logs/gateway.log
```

## Шаг 2 — Telegram smoke (ты)

- [x] Обычное сообщение → ответ
- [x] `/new` → подтверждение новой сессии
- [x] Длинный turn / много тулов → только «печатает…», **без** spam tool lines (default)
- [ ] Нет вечного `Error` после overflow (rotation)

## Шаг 3 — Reboot-test (ты)

```bash
# до reboot
launchctl list | grep csagent

# reboot Mac

# после (~2 мин)
launchctl list | grep csagent
grep "long-poll started" ~/.csagent/logs/gateway.log | tail -1
```

Ожидание: gateway снова в списке, long-poll в логе.

## Шаг 4 — Hermes vs csagent (решение)

Один bot token = один daemon.

| Режим | Команда |
|-------|---------|
| csagent | `bash ~/.csagent/csagent/deploy/install-launchd.sh` |
| Hermes | `bash ~/.csagent/csagent/deploy/uninstall-launchd.sh` + bootstrap Hermes plist |

- [ ] Зафиксировано: основной daemon = **csagent** / Hermes

## Шаг 5 — Cron (опционально, можно после Phase 0)

Сейчас `cron-tick` крутится, но **`cron.jobs.json` нет** — jobs пусто.

Пропустить, если scheduled задачи не нужны до Phase 2.

## Шаг 6 — Стабилизация (2 недели)

- [ ] Telegram без ручных рестартов
- [ ] Нет конфликта 409 с Hermes
- [ ] Dev loop: правки в Downloads → `setup-home.sh` → при необходимости reinstall launchd

**Stop condition:** если search/backup по истории не нужны — Phase 1 (Postgres) можно отложить.

---

## После Phase 0 (порядок фаз)

1. **Phase 1** — Store `sqlite | postgres`, `:5435`, migrations, `CSAGENT_DATABASE_URL`
2. **Phase 2** — MemPalace MCP в `~/.csagent/.mempalace/` (Chroma local)
3. **Phase 3** — unified PG schema, pgcrypto, optional JSONL mine

См. [TASKS.md](./TASKS.md).
