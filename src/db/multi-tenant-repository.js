import { supabase } from "./supabase.js";

const TABLE_USERS = "tg_users";
const TABLE_USER_SESSIONS = "tg_user_sessions";
const TABLE_TELEGRAM_ACCOUNTS = "tg_telegram_accounts";
const TABLE_CHANNEL_CONFIGS = "tg_channel_sync_configs";
const TABLE_SYNC_JOBS = "tg_sync_jobs";
const TABLE_SYNC_JOB_LOGS = "tg_sync_job_logs";
const TABLE_SYNC_STATE = "tg_channel_sync_state";
const TABLE_MESSAGE_MAP = "tg_channel_message_map";
const TABLE_BOT_UPDATES = "tg_bot_updates_log";

export async function createUser({ email, passwordHash }) {
  const { data, error } = await supabase
    .from(TABLE_USERS)
    .insert({
      email: String(email).trim().toLowerCase(),
      password_hash: passwordHash,
      status: "active",
    })
    .select("id, email, status, created_at")
    .single();
  if (error) throw new Error(`users insert failed: ${error.message}`);
  return data;
}

export async function countUsers() {
  const { count, error } = await supabase
    .from(TABLE_USERS)
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`users count failed: ${error.message}`);
  return Number(count ?? 0);
}

export async function loadUserByEmail(email) {
  const { data, error } = await supabase
    .from(TABLE_USERS)
    .select("id, email, password_hash, status")
    .eq("email", String(email).trim().toLowerCase())
    .maybeSingle();
  if (error) throw new Error(`users select by email failed: ${error.message}`);
  return data;
}

export async function createUserSession({ userId, tokenHash, expiresAt, userAgent = "", ipAddress = "" }) {
  const { data, error } = await supabase
    .from(TABLE_USER_SESSIONS)
    .insert({
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      user_agent: userAgent,
      ip_address: ipAddress,
    })
    .select("id, user_id, expires_at")
    .single();
  if (error) throw new Error(`user_sessions insert failed: ${error.message}`);
  return data;
}

export async function loadUserBySessionTokenHash(tokenHash) {
  const nowIso = new Date().toISOString();
  const { data: sessionRow, error: sessionError } = await supabase
    .from(TABLE_USER_SESSIONS)
    .select("id, user_id, expires_at")
    .eq("token_hash", tokenHash)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (sessionError) throw new Error(`user_sessions select failed: ${sessionError.message}`);
  if (!sessionRow) return null;

  const { data: userRow, error: userError } = await supabase
    .from(TABLE_USERS)
    .select("id, email, status")
    .eq("id", sessionRow.user_id)
    .maybeSingle();
  if (userError) throw new Error(`users select by id failed: ${userError.message}`);
  if (!userRow) return null;

  return {
    id: sessionRow.id,
    user_id: sessionRow.user_id,
    expires_at: sessionRow.expires_at,
    user: userRow,
  };
}

export async function deleteSessionByTokenHash(tokenHash) {
  const { error } = await supabase.from(TABLE_USER_SESSIONS).delete().eq("token_hash", tokenHash);
  if (error) throw new Error(`user_sessions delete failed: ${error.message}`);
}

export async function upsertTelegramAccount({ userId, sessionString }) {
  const { error } = await supabase.from(TABLE_TELEGRAM_ACCOUNTS).upsert(
    {
      user_id: userId,
      session_string: sessionString,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id", ignoreDuplicates: false }
  );
  if (error) throw new Error(`telegram_accounts upsert failed: ${error.message}`);
}

export async function loadTelegramAccountByUserId(userId) {
  const { data, error } = await supabase
    .from(TABLE_TELEGRAM_ACCOUNTS)
    .select("id, user_id, session_string, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`telegram_accounts select failed: ${error.message}`);
  return data;
}

export async function createChannelSyncConfig({
  userId,
  sourceChannelId,
  targetChatId,
  sourceType = "telegram_bot_channel",
  sourceChannelIdentifier = null,
  pollIntervalMs = 30000,
  pollLimit = 200,
}) {
  const { data, error } = await supabase
    .from(TABLE_CHANNEL_CONFIGS)
    .insert({
      user_id: userId,
      source_channel_id: sourceChannelId,
      source_type: sourceType,
      source_channel_identifier: sourceChannelIdentifier,
      target_chat_id: String(targetChatId),
      poll_interval_ms: pollIntervalMs,
      poll_limit: pollLimit,
      status: "active",
    })
    .select("*")
    .single();
  if (error) throw new Error(`channel_sync_configs insert failed: ${error.message}`);
  return data;
}

export async function listChannelSyncConfigsByUserId(userId) {
  const { data, error } = await supabase
    .from(TABLE_CHANNEL_CONFIGS)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`channel_sync_configs list failed: ${error.message}`);
  return data ?? [];
}

export async function loadChannelSyncConfigByIdForUser(userId, configId) {
  const { data, error } = await supabase
    .from(TABLE_CHANNEL_CONFIGS)
    .select("*")
    .eq("id", configId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`channel_sync_configs select failed: ${error.message}`);
  return data;
}

export async function updateChannelSyncConfigStatus({ userId, configId, status }) {
  const { data, error } = await supabase
    .from(TABLE_CHANNEL_CONFIGS)
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", configId)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw new Error(`channel_sync_configs status update failed: ${error.message}`);
  return data;
}

export async function deleteChannelSyncConfig({ userId, configId }) {
  const { error } = await supabase
    .from(TABLE_CHANNEL_CONFIGS)
    .delete()
    .eq("id", configId)
    .eq("user_id", userId);
  if (error) throw new Error(`channel_sync_configs delete failed: ${error.message}`);
}

export async function listActiveChannelSyncConfigs() {
  const { data, error } = await supabase
    .from(TABLE_CHANNEL_CONFIGS)
    .select("*")
    .eq("status", "active");
  if (error) throw new Error(`channel_sync_configs active list failed: ${error.message}`);
  return data ?? [];
}

export async function loadActiveChannelSyncConfigByTelegramChat({ chatId, chatUsername }) {
  const normalizedChatId = String(chatId ?? "").trim();
  const normalizedChatUsername = String(chatUsername ?? "").trim().toLowerCase();
  let query = supabase
    .from(TABLE_CHANNEL_CONFIGS)
    .select("*")
    .eq("status", "active")
    .eq("source_type", "telegram_bot_channel");

  if (normalizedChatId) {
    query = query.or(
      `source_channel_identifier.eq.${normalizedChatId},source_channel_id.eq.${normalizedChatId}`
    );
  } else if (normalizedChatUsername) {
    query = query.eq("source_channel_id", normalizedChatUsername);
  } else {
    return null;
  }

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw new Error(`channel_sync_configs telegram chat lookup failed: ${error.message}`);
  return data;
}

export async function updateChannelBotConnectionStatus({
  userId,
  configId,
  sourceChannelIdentifier,
  botMembershipStatus,
  sourceChannelId = null,
}) {
  const updatePayload = {
    source_type: "telegram_bot_channel",
    source_channel_identifier: String(sourceChannelIdentifier ?? ""),
    bot_membership_status: botMembershipStatus,
    bot_permissions_validated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (sourceChannelId) {
    updatePayload.source_channel_id = String(sourceChannelId).trim();
  }
  const { data, error } = await supabase
    .from(TABLE_CHANNEL_CONFIGS)
    .update(updatePayload)
    .eq("id", configId)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw new Error(`channel_sync_configs bot status update failed: ${error.message}`);
  return data;
}

export async function markChannelWebhookUpdateSeen(configId) {
  const { error } = await supabase
    .from(TABLE_CHANNEL_CONFIGS)
    .update({
      last_webhook_update_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", configId);
  if (error) throw new Error(`channel_sync_configs webhook timestamp update failed: ${error.message}`);
}

export async function markChannelJobProcessed(configId) {
  const { error } = await supabase
    .from(TABLE_CHANNEL_CONFIGS)
    .update({
      last_processed_update_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error_at: null,
      last_error_message: null,
    })
    .eq("id", configId);
  if (error) throw new Error(`channel_sync_configs processed timestamp update failed: ${error.message}`);
}

export async function markChannelJobError(configId, errorMessage) {
  const { error } = await supabase
    .from(TABLE_CHANNEL_CONFIGS)
    .update({
      last_error_at: new Date().toISOString(),
      last_error_message: String(errorMessage ?? "").slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", configId);
  if (error) throw new Error(`channel_sync_configs error update failed: ${error.message}`);
}

export async function hasPendingOrProcessingJob(configId) {
  const { count, error } = await supabase
    .from(TABLE_SYNC_JOBS)
    .select("id", { head: true, count: "exact" })
    .eq("channel_sync_config_id", configId)
    .in("status", ["pending", "processing"]);
  if (error) throw new Error(`sync_jobs pending count failed: ${error.message}`);
  return Number(count ?? 0) > 0;
}

export async function enqueueSyncJob({
  userId,
  configId,
  jobType = "legacy_poll",
  eventType = null,
  sourceMessageId = null,
  externalEventId = null,
  payload = {},
}) {
  const { data, error } = await supabase
    .from(TABLE_SYNC_JOBS)
    .insert({
      user_id: userId,
      channel_sync_config_id: configId,
      status: "pending",
      job_type: jobType,
      event_type: eventType,
      source_message_id: sourceMessageId,
      external_event_id: externalEventId,
      payload,
      scheduled_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (!error) return { queued: true, job: data };
  if (error.code === "23505") return { queued: false, job: null };
  throw new Error(`sync_jobs insert failed: ${error.message}`);
}

export async function recordBotWebhookUpdate({
  userId,
  configId,
  updateId,
  sourceMessageId,
  eventType,
  payload,
}) {
  const { data, error } = await supabase
    .from(TABLE_BOT_UPDATES)
    .insert({
      user_id: userId,
      channel_sync_config_id: configId,
      update_id: updateId,
      source_message_id: sourceMessageId,
      event_type: eventType,
      payload,
      status: "queued",
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (!error) return { queued: true, row: data };
  if (error.code === "23505") return { queued: false, row: null };
  throw new Error(`tg_bot_updates insert failed: ${error.message}`);
}

export async function markBotWebhookUpdateProcessed(configId, updateId) {
  const { error } = await supabase
    .from(TABLE_BOT_UPDATES)
    .update({
      status: "done",
      processed_at: new Date().toISOString(),
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("channel_sync_config_id", configId)
    .eq("update_id", updateId);
  if (error) throw new Error(`tg_bot_updates done update failed: ${error.message}`);
}

export async function markBotWebhookUpdateFailed(configId, updateId, errorMessage) {
  const { error } = await supabase
    .from(TABLE_BOT_UPDATES)
    .update({
      status: "error",
      error_message: String(errorMessage ?? "").slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("channel_sync_config_id", configId)
    .eq("update_id", updateId);
  if (error) throw new Error(`tg_bot_updates failed update failed: ${error.message}`);
}

export async function loadChannelStatusMetrics({ userId, configId }) {
  const [jobsResult, updatesResult, latencyRowsResult] = await Promise.all([
    supabase
      .from(TABLE_SYNC_JOBS)
      .select("status", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("channel_sync_config_id", configId)
      .eq("status", "pending"),
    supabase
      .from(TABLE_BOT_UPDATES)
      .select("status", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("channel_sync_config_id", configId)
      .eq("status", "error"),
    supabase
      .from(TABLE_SYNC_JOBS)
      .select("processing_latency_ms")
      .eq("user_id", userId)
      .eq("channel_sync_config_id", configId)
      .eq("status", "done")
      .not("processing_latency_ms", "is", null)
      .order("finished_at", { ascending: false })
      .limit(50),
  ]);
  if (jobsResult.error) throw new Error(`status metrics pending count failed: ${jobsResult.error.message}`);
  if (updatesResult.error) throw new Error(`status metrics error count failed: ${updatesResult.error.message}`);
  if (latencyRowsResult.error) {
    throw new Error(`status metrics latency query failed: ${latencyRowsResult.error.message}`);
  }
  const latencyRows = latencyRowsResult.data ?? [];
  const averageProcessingLatencyMs =
    latencyRows.length > 0
      ? Math.round(
          latencyRows.reduce(
            (sum, latencyRow) => sum + Number(latencyRow.processing_latency_ms ?? 0),
            0
          ) / latencyRows.length
        )
      : null;
  return {
    pendingQueueDepth: Number(jobsResult.count ?? 0),
    webhookErrors: Number(updatesResult.count ?? 0),
    averageProcessingLatencyMs,
  };
}

export async function listRecentBotWebhookUpdates({ userId, configId, limit = 50 }) {
  const { data, error } = await supabase
    .from(TABLE_BOT_UPDATES)
    .select("update_id, source_message_id, event_type, status, error_message, created_at, processed_at")
    .eq("user_id", userId)
    .eq("channel_sync_config_id", configId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`tg_bot_updates list failed: ${error.message}`);
  return data ?? [];
}

export async function listActiveLegacyPollingConfigs() {
  const { data, error } = await supabase
    .from(TABLE_CHANNEL_CONFIGS)
    .select("*")
    .eq("status", "active")
    .neq("source_type", "telegram_bot_channel");
  if (error) throw new Error(`legacy polling config list failed: ${error.message}`);
  return data ?? [];
}

export async function claimPendingJobs({ limit }) {
  const { data, error } = await supabase
    .from(TABLE_SYNC_JOBS)
    .select("*")
    .eq("status", "pending")
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`sync_jobs select pending failed: ${error.message}`);

  const claimedJobs = [];
  for (const pendingJob of data ?? []) {
    const { data: updatedRows, error: updateError } = await supabase
      .from(TABLE_SYNC_JOBS)
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", pendingJob.id)
      .eq("status", "pending")
      .select("id");
    if (updateError) throw new Error(`sync_jobs claim update failed: ${updateError.message}`);
    if (updatedRows?.length) {
      claimedJobs.push(pendingJob);
    }
  }
  return claimedJobs;
}

export async function markSyncJobDone(jobId, { processingLatencyMs = null } = {}) {
  const { error } = await supabase
    .from(TABLE_SYNC_JOBS)
    .update({
      status: "done",
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_message: null,
      processing_latency_ms: processingLatencyMs,
    })
    .eq("id", jobId);
  if (error) throw new Error(`sync_jobs done update failed: ${error.message}`);
}

export async function markSyncJobFailed({ jobId, attemptCount, maxAttempts, errorMessage }) {
  const isDeadLetter = attemptCount >= maxAttempts;
  const retryAt = new Date(Date.now() + Math.min(60000 * attemptCount, 300000)).toISOString();
  const { error } = await supabase
    .from(TABLE_SYNC_JOBS)
    .update({
      status: isDeadLetter ? "error" : "pending",
      attempt_count: attemptCount,
      next_retry_at: isDeadLetter ? null : retryAt,
      error_message: String(errorMessage ?? "").slice(0, 1000),
      finished_at: isDeadLetter ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (error) throw new Error(`sync_jobs failed update failed: ${error.message}`);
}

export async function addSyncJobLog({
  userId,
  configId,
  jobId = null,
  level,
  message,
  details = {},
}) {
  const { error } = await supabase.from(TABLE_SYNC_JOB_LOGS).insert({
    user_id: userId,
    channel_sync_config_id: configId,
    sync_job_id: jobId,
    level,
    message,
    details,
  });
  if (error) throw new Error(`sync_job_logs insert failed: ${error.message}`);
}

export async function listSyncJobLogsByUser({ userId, configId = null, limit = 200 }) {
  let query = supabase
    .from(TABLE_SYNC_JOB_LOGS)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (configId) {
    query = query.eq("channel_sync_config_id", configId);
  }
  const { data, error } = await query;
  if (error) throw new Error(`sync_job_logs list failed: ${error.message}`);
  return data ?? [];
}

export async function listSyncJobsByUser({ userId, configId = null, limit = 100 }) {
  let query = supabase
    .from(TABLE_SYNC_JOBS)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (configId) {
    query = query.eq("channel_sync_config_id", configId);
  }
  const { data, error } = await query;
  if (error) throw new Error(`sync_jobs list failed: ${error.message}`);
  return data ?? [];
}

export async function loadOrCreateChannelSyncState({ userId, configId }) {
  const { data, error } = await supabase
    .from(TABLE_SYNC_STATE)
    .select("*")
    .eq("user_id", userId)
    .eq("channel_sync_config_id", configId)
    .maybeSingle();
  if (error) throw new Error(`channel_sync_state select failed: ${error.message}`);
  if (data) return data;

  const { data: inserted, error: insertError } = await supabase
    .from(TABLE_SYNC_STATE)
    .insert({
      user_id: userId,
      channel_sync_config_id: configId,
      last_message_id: 0,
      last_scan_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (insertError) throw new Error(`channel_sync_state insert failed: ${insertError.message}`);
  return inserted;
}

export async function updateChannelSyncState({ userId, configId, lastMessageId }) {
  const { error } = await supabase
    .from(TABLE_SYNC_STATE)
    .update({
      last_message_id: lastMessageId,
      last_scan_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("channel_sync_config_id", configId);
  if (error) throw new Error(`channel_sync_state update failed: ${error.message}`);
}

export async function loadMappedMessage({ userId, configId, sourceMessageId }) {
  const { data, error } = await supabase
    .from(TABLE_MESSAGE_MAP)
    .select("*")
    .eq("user_id", userId)
    .eq("channel_sync_config_id", configId)
    .eq("source_message_id", sourceMessageId)
    .maybeSingle();
  if (error) throw new Error(`channel_message_map select failed: ${error.message}`);
  return data;
}

export async function upsertMappedMessage({
  userId,
  configId,
  sourceMessageId,
  targetMessageId,
  sourceHash,
}) {
  const { error } = await supabase.from(TABLE_MESSAGE_MAP).upsert(
    {
      user_id: userId,
      channel_sync_config_id: configId,
      source_message_id: sourceMessageId,
      target_message_id: targetMessageId ? String(targetMessageId) : null,
      source_hash: sourceHash,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id,channel_sync_config_id,source_message_id",
      ignoreDuplicates: false,
    }
  );
  if (error) throw new Error(`channel_message_map upsert failed: ${error.message}`);
}
