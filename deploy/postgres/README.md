# irida Postgres (Phase 1)

PostgreSQL 18 with **pgvector** (v0.8.1) and **pgcrypto**. Host port **5435** — separate from TParser (`:5433`).

## Start

From repo root:

```bash
docker compose -f deploy/docker-compose.irida.yml up -d --build   # memory + embedder
docker compose -f deploy/docker-compose.irida.yml ps
```

Postgres only (stop):

```bash
docker compose -f deploy/docker-compose.irida.yml down
```

## psql

```bash
PGPASSWORD=irida psql -h 127.0.0.1 -p 5435 -U irida -d irida_memory
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
| `IRIDA_POSTGRES_DB` | `irida_memory` |
| `IRIDA_POSTGRES_HOST_PORT` | `5435` |

Connection URL (the live memory store):

```bash
export IRIDA_DATABASE_URL="postgresql://irida:irida@127.0.0.1:5435/irida_memory"
```

With custom password:

```bash
export IRIDA_DATABASE_URL="postgresql://${IRIDA_POSTGRES_USER}:${IRIDA_POSTGRES_PASSWORD}@127.0.0.1:${IRIDA_POSTGRES_HOST_PORT:-5435}/${IRIDA_POSTGRES_DB:-irida_memory}"
```

Volume: `csagent_pg_data` (Docker named volume — reused as-is across the I-131 rebrand, not renamed).
