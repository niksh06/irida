# csagent Phase 1: pgvector + pgcrypto on PostgreSQL 18 (lighter than TParser postgres-poc).
FROM postgres:18-bookworm

USER root
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        build-essential \
        postgresql-server-dev-18 \
        postgresql-contrib-18 \
    && git clone --depth 1 --branch v0.8.1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && cd /tmp/pgvector && make clean && make OPTFLAGS="" && make install \
    && rm -rf /tmp/pgvector /var/lib/apt/lists/*

USER postgres
