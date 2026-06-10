-- Semantic search embeddings for memory notes (I-36, local Ollama + pgvector).
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE memory_notes ADD COLUMN IF NOT EXISTS embedding vector(768);
CREATE INDEX IF NOT EXISTS idx_memory_notes_embedding
  ON memory_notes USING hnsw (embedding vector_cosine_ops);
