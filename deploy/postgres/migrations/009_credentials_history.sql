-- Secret overwrite history (postmortem 2026-06-12): every upsert of
-- credential_secrets first archives the previous ciphertext, so a bad
-- auth login (truncated stdin, dev clone pointed at prod PG) can be
-- rolled back with `csagent auth history` / `auth restore`.
CREATE TABLE IF NOT EXISTS credential_secrets_history (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  ciphertext BYTEA NOT NULL,
  replaced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credential_secrets_history_name
  ON credential_secrets_history (name, replaced_at DESC);
