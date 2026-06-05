-- Encrypted API secrets (cursor + telegram) via pgcrypto symmetric encryption.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS credential_secrets (
  name TEXT PRIMARY KEY CHECK (name IN ('cursor_api_key', 'telegram_bot_token')),
  ciphertext BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
