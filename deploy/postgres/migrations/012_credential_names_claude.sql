-- I-145: claude-agent credentials join the pgcrypto store. 004 baked the
-- allowed names into an inline CHECK; widen it to the four current names.
-- Idempotent: drop-if-exists + re-add under a stable constraint name.
ALTER TABLE credential_secrets
  DROP CONSTRAINT IF EXISTS credential_secrets_name_check;
ALTER TABLE credential_secrets
  ADD CONSTRAINT credential_secrets_name_check
  CHECK (name IN ('cursor_api_key', 'telegram_bot_token', 'anthropic_api_key', 'claude_code_oauth_token'));
