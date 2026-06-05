-- Full-text search on memory notes (P2-7).
ALTER TABLE memory_notes
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(title, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(body, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_memory_notes_search ON memory_notes USING GIN (search_vector);
