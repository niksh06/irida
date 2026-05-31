-- csagent-memory: verbatim notes + temporal facts (MemPalace replacement, native PG/SQLite)

CREATE TABLE IF NOT EXISTS memory_notes (
  name TEXT PRIMARY KEY,
  wing TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_notes_wing ON memory_notes(wing, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_facts (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  source TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_facts_subject ON memory_facts(subject, predicate);
CREATE INDEX IF NOT EXISTS idx_memory_facts_lookup ON memory_facts(subject, predicate, object);
