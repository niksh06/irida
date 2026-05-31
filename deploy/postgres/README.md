# csagent Postgres (Phase 1)

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
PGPASSWORD=csagent psql -h 127.0.0.1 -p 5435 -U csagent -d csagent
```

Verify extensions:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'pgcrypto');
```

## Env

| Variable | Default |
|----------|---------|
| `CSAGENT_POSTGRES_USER` | `csagent` |
| `CSAGENT_POSTGRES_PASSWORD` | `csagent` |
| `CSAGENT_POSTGRES_DB` | `csagent` |
| `CSAGENT_POSTGRES_HOST_PORT` | `5435` |

Connection URL for future Store backend (not wired in csagent yet):

```bash
export CSAGENT_DATABASE_URL="postgresql://csagent:csagent@127.0.0.1:5435/csagent"
```

With custom password:

```bash
export CSAGENT_DATABASE_URL="postgresql://${CSAGENT_POSTGRES_USER}:${CSAGENT_POSTGRES_PASSWORD}@127.0.0.1:${CSAGENT_POSTGRES_HOST_PORT:-5435}/${CSAGENT_POSTGRES_DB:-csagent}"
```

Volume: `csagent_pg_data` (Docker named volume).
