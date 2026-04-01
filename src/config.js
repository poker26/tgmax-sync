import "dotenv/config";

const required = (name) => {
  const value = process.env[name];
  if (value == null || value === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
};

const optional = (name, defaultValue = "") => process.env[name] ?? defaultValue;

export const config = {
  telegram: {
    apiId: parseInt(optional("TG_API_ID", "0"), 10),
    apiHash: optional("TG_API_HASH"),
    session: optional("TG_SESSION"),
    botToken: optional("TG_BOT_TOKEN"),
    botApiBaseUrl: optional("TG_BOT_API_BASE_URL", "https://api.telegram.org"),
    webhookSecret: optional("TG_BOT_WEBHOOK_SECRET"),
    importLimit: parseInt(optional("TG_IMPORT_LIMIT", "200"), 10),
  },
  supabase: {
    url: required("SUPABASE_URL"),
    serviceKey: required("SUPABASE_SERVICE_KEY"),
  },
  minio: {
    endpoint: optional("MINIO_ENDPOINT"),
    accessKey: optional("MINIO_ACCESS_KEY"),
    secretKey: optional("MINIO_SECRET_KEY"),
    bucketMedia: optional("MINIO_BUCKET_MEDIA", "tgmax-sync-media"),
  },
  max: {
    botToken: optional("MAX_BOT_TOKEN"),
    apiBaseUrl: optional("MAX_API_BASE_URL", "https://platform-api.max.ru"),
    postDelayMs: parseInt(optional("MAX_POST_DELAY_MS", "5000"), 10),
  },
  sync: {
    pollIntervalMs: parseInt(optional("SYNC_POLL_INTERVAL_MS", "30000"), 10),
    pollLimit: parseInt(optional("SYNC_POLL_LIMIT", "200"), 10),
    eventBatchSize: parseInt(optional("SYNC_EVENT_BATCH_SIZE", "50"), 10),
    lockTtlMs: parseInt(optional("SYNC_LOCK_TTL_MS", "120000"), 10),
    lockName: optional("SYNC_LOCK_NAME", "tg_master_to_max_worker"),
    staleProcessingMs: parseInt(optional("SYNC_STALE_PROCESSING_MS", "600000"), 10),
    maxAttempts: parseInt(optional("SYNC_MAX_ATTEMPTS", "8"), 10),
    retryBaseDelayMs: parseInt(optional("SYNC_RETRY_BASE_DELAY_MS", "2000"), 10),
    deleteFallbackMode: optional("SYNC_DELETE_FALLBACK_MODE", "tombstone"),
    schedulerIntervalMs: parseInt(optional("SYNC_SCHEDULER_INTERVAL_MS", "10000"), 10),
    workerConcurrency: parseInt(optional("SYNC_WORKER_CONCURRENCY", "2"), 10),
  },
  web: {
    port: parseInt(optional("WEB_PORT", "3030"), 10),
    sessionTtlHours: parseInt(optional("WEB_SESSION_TTL_HOURS", "72"), 10),
  },
};

export default config;
