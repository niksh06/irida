-- Encrypted Telegram/webhook peer allowlist (pgcrypto). Active when CSAGENT_SECRETS_KEY is set.
CREATE TABLE IF NOT EXISTS gateway_allowed_chats (
  id SERIAL PRIMARY KEY,
  adapter TEXT NOT NULL DEFAULT 'telegram',
  ciphertext BYTEA NOT NULL,
  source TEXT NOT NULL DEFAULT 'allowlist' CHECK (source IN ('allowlist', 'pairing')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gateway_allowed_chats_adapter ON gateway_allowed_chats (adapter);
