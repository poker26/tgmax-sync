CREATE TABLE IF NOT EXISTS tg_initial_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES tg_users(id) ON DELETE CASCADE,
  channel_sync_config_id UUID NOT NULL REFERENCES tg_channel_sync_configs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'error', 'cancelled')),
  mode TEXT NOT NULL DEFAULT 'full'
    CHECK (mode IN ('full', 'test')),
  process_pid BIGINT,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  progress_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  log_excerpt TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_initial_import_runs_user_config
  ON tg_initial_import_runs(user_id, channel_sync_config_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tg_initial_import_run_active
  ON tg_initial_import_runs(channel_sync_config_id)
  WHERE status IN ('pending', 'running');
