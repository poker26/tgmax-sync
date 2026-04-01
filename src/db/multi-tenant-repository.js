import { supabase } from "./supabase.js";

export async function createUser({ email, passwordHash }) {
  const { data, error } = await supabase
    .from("users")
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
    .from("users")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`users count failed: ${error.message}`);
  return Number(count ?? 0);
}

export async function loadUserByEmail(email) {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, password_hash, status")
    .eq("email", String(email).trim().toLowerCase())
    .maybeSingle();
  if (error) throw new Error(`users select by email failed: ${error.message}`);
  return data;
}

export async function createUserSession({ userId, tokenHash, expiresAt, userAgent = "", ipAddress = "" }) {
  const { data, error } = await supabase
    .from("user_sessions")
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
  const { data, error } = await supabase
    .from("user_sessions")
    .select("id, user_id, expires_at, users(id, email, status)")
    .eq("token_hash", tokenHash)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (error) throw new Error(`user_sessions select failed: ${error.message}`);
  return data;
}

export async function deleteSessionByTokenHash(tokenHash) {
  const { error } = await supabase.from("user_sessions").delete().eq("token_hash", tokenHash);
  if (error) throw new Error(`user_sessions delete failed: ${error.message}`);
}

export async function upsertTelegramAccount({ userId, sessionString }) {
  const { error } = await supabase.from("telegram_accounts").upsert(
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
    .from("telegram_accounts")
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
  pollIntervalMs = 30000,
  pollLimit = 200,
}) {
  const { data, error } = await supabase
    .from("channel_sync_configs")
    .insert({
      user_id: userId,
      source_channel_id: sourceChannelId,
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
    .from("channel_sync_configs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`channel_sync_configs list failed: ${error.message}`);
  return data ?? [];
}

export async function loadChannelSyncConfigByIdForUser(userId, configId) {
  const { data, error } = await supabase
    .from("channel_sync_configs")
    .select("*")
    .eq("id", configId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`channel_sync_configs select failed: ${error.message}`);
  return data;
}

export async function updateChannelSyncConfigStatus({ userId, configId, status }) {
  const { data, error } = await supabase
    .from("channel_sync_configs")
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
    .from("channel_sync_configs")
    .delete()
    .eq("id", configId)
    .eq("user_id", userId);
  if (error) throw new Error(`channel_sync_configs delete failed: ${error.message}`);
}

export async function listActiveChannelSyncConfigs() {
  const { data, error } = await supabase
    .from("channel_sync_configs")
    .select("*")
    .eq("status", "active");
  if (error) throw new Error(`channel_sync_configs active list failed: ${error.message}`);
  return data ?? [];
}

export async function hasPendingOrProcessingJob(configId) {
  const { count, error } = await supabase
    .from("sync_jobs")
    .select("id", { head: true, count: "exact" })
    .eq("channel_sync_config_id", configId)
    .in("status", ["pending", "processing"]);
  if (error) throw new Error(`sync_jobs pending count failed: ${error.message}`);
  return Number(count ?? 0) > 0;
}

export async function enqueueSyncJob({ userId, configId }) {
  const { data, error } = await supabase
    .from("sync_jobs")
    .insert({
      user_id: userId,
      channel_sync_config_id: configId,
      status: "pending",
      scheduled_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw new Error(`sync_jobs insert failed: ${error.message}`);
  return data;
}

export async function claimPendingJobs({ limit }) {
  const { data, error } = await supabase
    .from("sync_jobs")
    .select("*")
    .eq("status", "pending")
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`sync_jobs select pending failed: ${error.message}`);

  const claimedJobs = [];
  for (const pendingJob of data ?? []) {
    const { data: updatedRows, error: updateError } = await supabase
      .from("sync_jobs")
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

export async function markSyncJobDone(jobId) {
  const { error } = await supabase
    .from("sync_jobs")
    .update({
      status: "done",
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", jobId);
  if (error) throw new Error(`sync_jobs done update failed: ${error.message}`);
}

export async function markSyncJobFailed({ jobId, attemptCount, maxAttempts, errorMessage }) {
  const isDeadLetter = attemptCount >= maxAttempts;
  const retryAt = new Date(Date.now() + Math.min(60000 * attemptCount, 300000)).toISOString();
  const { error } = await supabase
    .from("sync_jobs")
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
  const { error } = await supabase.from("sync_job_logs").insert({
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
    .from("sync_job_logs")
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
    .from("sync_jobs")
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
    .from("channel_sync_state")
    .select("*")
    .eq("user_id", userId)
    .eq("channel_sync_config_id", configId)
    .maybeSingle();
  if (error) throw new Error(`channel_sync_state select failed: ${error.message}`);
  if (data) return data;

  const { data: inserted, error: insertError } = await supabase
    .from("channel_sync_state")
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
    .from("channel_sync_state")
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
    .from("channel_message_map")
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
  const { error } = await supabase.from("channel_message_map").upsert(
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
