-- I-100: record which engine (cursor | claude-agent) created a session, so resume
-- can refuse a cross-engine continuation (sdk_agent_id is engine-specific).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'cursor';
