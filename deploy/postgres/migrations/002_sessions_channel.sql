ALTER TABLE sessions ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_sessions_channel ON sessions(channel, updated_at DESC);
