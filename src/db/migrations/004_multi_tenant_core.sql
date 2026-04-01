CREATE TABLE IF NOT EXISTS tg_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tg_user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES tg_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_user_sessions_user
  ON tg_user_sessions(user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS tg_telegram_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES tg_users(id) ON DELETE CASCADE,
  session_string TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tg_channel_sync_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES tg_users(id) ON DELETE CASCADE,
  source_channel_id TEXT NOT NULL,
  target_chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  poll_interval_ms INTEGER NOT NULL DEFAULT 30000,
  poll_limit INTEGER NOT NULL DEFAULT 200,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_enqueued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_channel_sync_per_user UNIQUE (user_id, source_channel_id, target_chat_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_channel_sync_configs_status
  ON tg_channel_sync_configs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS tg_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES tg_users(id) ON DELETE CASCADE,
  channel_sync_config_id UUID NOT NULL REFERENCES tg_channel_sync_configs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'error')),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_sync_jobs_status
  ON tg_sync_jobs(status, scheduled_at, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_tg_sync_jobs_config
  ON tg_sync_jobs(channel_sync_config_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tg_sync_job_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES tg_users(id) ON DELETE CASCADE,
  channel_sync_config_id UUID NOT NULL REFERENCES tg_channel_sync_configs(id) ON DELETE CASCADE,
  sync_job_id UUID REFERENCES tg_sync_jobs(id) ON DELETE SET NULL,
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_sync_job_logs_channel
  ON tg_sync_job_logs(channel_sync_config_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tg_channel_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES tg_users(id) ON DELETE CASCADE,
  channel_sync_config_id UUID NOT NULL UNIQUE REFERENCES tg_channel_sync_configs(id) ON DELETE CASCADE,
  last_message_id BIGINT NOT NULL DEFAULT 0,
  last_scan_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tg_channel_message_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES tg_users(id) ON DELETE CASCADE,
  channel_sync_config_id UUID NOT NULL REFERENCES tg_channel_sync_configs(id) ON DELETE CASCADE,
  source_message_id BIGINT NOT NULL,
  target_message_id TEXT,
  source_hash TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_channel_message_map UNIQUE (user_id, channel_sync_config_id, source_message_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_channel_message_map_config
  ON tg_channel_message_map(channel_sync_config_id, source_message_id DESC);
