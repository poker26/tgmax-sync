ALTER TABLE tg_channel_sync_configs
ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'telegram_bot_channel'
  CHECK (source_type IN ('telegram_bot_channel', 'telegram_mtproto_poll')),
ADD COLUMN IF NOT EXISTS source_channel_identifier TEXT,
ADD COLUMN IF NOT EXISTS bot_membership_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (bot_membership_status IN ('unknown', 'connected', 'insufficient_rights', 'not_found', 'error')),
ADD COLUMN IF NOT EXISTS bot_permissions_validated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_webhook_update_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_processed_update_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_tg_channel_sync_configs_source
  ON tg_channel_sync_configs(source_type, source_channel_identifier);

ALTER TABLE tg_sync_jobs
ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'legacy_poll'
  CHECK (job_type IN ('legacy_poll', 'telegram_webhook')),
ADD COLUMN IF NOT EXISTS event_type TEXT
  CHECK (event_type IN ('create', 'edit', 'unknown')),
ADD COLUMN IF NOT EXISTS source_message_id BIGINT,
ADD COLUMN IF NOT EXISTS external_event_id TEXT,
ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS processing_latency_ms INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tg_sync_jobs_external_event
  ON tg_sync_jobs(channel_sync_config_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tg_bot_updates_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES tg_users(id) ON DELETE CASCADE,
  channel_sync_config_id UUID NOT NULL REFERENCES tg_channel_sync_configs(id) ON DELETE CASCADE,
  update_id BIGINT NOT NULL,
  source_message_id BIGINT,
  event_type TEXT NOT NULL CHECK (event_type IN ('create', 'edit', 'unknown')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'processing', 'done', 'error')),
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_tg_bot_updates UNIQUE (channel_sync_config_id, update_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_bot_updates_status
  ON tg_bot_updates_log(status, created_at DESC);
