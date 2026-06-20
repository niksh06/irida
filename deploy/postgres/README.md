# irida Postgres (Phase 1)

PostgreSQL 18 with **pgvector** (v0.8.1) and **pgcrypto**. Host port **5435** — separate from TParser (`:5433`).

## Start

From repo root:

```bash
docker compose -f deploy/docker-compose.csagent-postgres.yml up -d --build
docker compose -f deploy/docker-compose.csagent-postgres.yml ps
```

Postgres only (stop):

```bash
docker compose -f deploy/docker-compose.csagent-postgres.yml down
```

## psql

```bash
PGPASSWORD=irida psql -h 127.0.0.1 -p 5435 -U irida -d csagent
```

Verify extensions:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'pgcrypto');
```

## Env

| Variable | Default |
|----------|---------|
| `IRIDA_POSTGRES_USER` | `irida` |
| `IRIDA_POSTGRES_PASSWORD` | `irida` |
| `IRIDA_POSTGRES_DB` | `irida` |
| `IRIDA_POSTGRES_HOST_PORT` | `5435` |

Connection URL for future Store backend (not wired in irida yet):

```bash
export IRIDA_DATABASE_URL="postgresql://csagent:csagent@127.0.0.1:5435/csagent"
```

With custom password:

```bash
export IRIDA_DATABASE_URL="postgresql://${IRIDA_POSTGRES_USER}:${IRIDA_POSTGRES_PASSWORD}@127.0.0.1:${IRIDA_POSTGRES_HOST_PORT:-5435}/${IRIDA_POSTGRES_DB:-csagent}"
```

Volume: `csagent_pg_data` (Docker named volume).
