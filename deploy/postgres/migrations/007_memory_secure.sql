-- Encrypted bodies for wing='secure' notes (I-20, Option A).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE memory_notes ADD COLUMN IF NOT EXISTS body_enc bytea;
