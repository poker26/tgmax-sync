ALTER TABLE tg_channel_sync_configs
DROP CONSTRAINT IF EXISTS uq_channel_sync_per_user;

ALTER TABLE tg_channel_sync_configs
ADD CONSTRAINT uq_channel_sync_per_user
UNIQUE (user_id, source_channel_id, target_chat_id);
