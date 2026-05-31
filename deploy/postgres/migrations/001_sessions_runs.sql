-- csagent Phase 1: sessions + runs (mirrors sqlite schema in store.ts)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  cwd TEXT NOT NULL DEFAULT '',
  runtime TEXT NOT NULL DEFAULT 'local',
  sdk_agent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_status TEXT NOT NULL DEFAULT '',
  selected_skills TEXT NOT NULL DEFAULT '',
  mcp_server_names TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sdk_agent_id TEXT,
  sdk_run_id TEXT,
  prompt_preview TEXT NOT NULL DEFAULT '',
  result_preview TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  error_kind TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  cwd TEXT NOT NULL DEFAULT '',
  runtime TEXT NOT NULL DEFAULT 'local',
  model TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id);
