import { config } from "../config.js";
import { getMaxBotMe } from "../max/api.js";
import {
  addSyncJobLog,
  claimPendingJobs,
  enqueueSyncJob,
  hasPendingOrProcessingJob,
  listActiveChannelSyncConfigs,
  loadTelegramAccountByUserId,
  markSyncJobDone,
  markSyncJobFailed,
} from "../db/multi-tenant-repository.js";
import { processChannelSyncJob } from "./channel-processor.js";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function enqueueDueJobs() {
  const activeConfigs = await listActiveChannelSyncConfigs();
  for (const activeConfig of activeConfigs) {
    const hasRunningJob = await hasPendingOrProcessingJob(activeConfig.id);
    if (hasRunningJob) continue;
    await enqueueSyncJob({
      userId: activeConfig.user_id,
      configId: activeConfig.id,
    });
  }
}

async function processSingleJob(syncJob) {
  const channelConfigId = syncJob.channel_sync_config_id;
  const userId = syncJob.user_id;
  const telegramAccount = await loadTelegramAccountByUserId(userId);
  if (!telegramAccount || telegramAccount.status !== "active") {
    throw new Error("Telegram account session is missing or disabled for this user.");
  }

  const activeConfigs = await listActiveChannelSyncConfigs();
  const configRow = activeConfigs.find(
    (candidateConfig) => candidateConfig.id === channelConfigId && candidateConfig.user_id === userId
  );
  if (!configRow) {
    throw new Error("Channel sync config is missing, inactive, or not owned by job user.");
  }
  if (String(configRow.user_id) !== String(syncJob.user_id)) {
    throw new Error("Tenant isolation violation: job user does not match channel config owner.");
  }
  if (String(telegramAccount.user_id) !== String(syncJob.user_id)) {
    throw new Error("Tenant isolation violation: Telegram session owner mismatch.");
  }

  const syncResult = await processChannelSyncJob({
    userId,
    configId: configRow.id,
    sourceChannelId: configRow.source_channel_id,
    targetChatId: configRow.target_chat_id,
    pollLimit: configRow.poll_limit,
    sessionString: telegramAccount.session_string,
  });

  await addSyncJobLog({
    userId,
    configId: configRow.id,
    jobId: syncJob.id,
    level: "info",
    message: "Sync iteration completed.",
    details: syncResult,
  });
}

async function runWorkerBatch() {
  const pendingJobs = await claimPendingJobs({
    limit: Math.max(1, config.sync.workerConcurrency),
  });
  if (!pendingJobs.length) return;

  await Promise.all(
    pendingJobs.map(async (pendingJob) => {
      try {
        await processSingleJob(pendingJob);
        await markSyncJobDone(pendingJob.id);
      } catch (error) {
        const nextAttemptCount = Number(pendingJob.attempt_count ?? 0) + 1;
        await markSyncJobFailed({
          jobId: pendingJob.id,
          attemptCount: nextAttemptCount,
          maxAttempts: config.sync.maxAttempts,
          errorMessage: error?.message ?? String(error),
        });
        await addSyncJobLog({
          userId: pendingJob.user_id,
          configId: pendingJob.channel_sync_config_id,
          jobId: pendingJob.id,
          level: "error",
          message: "Sync iteration failed.",
          details: {
            error: error?.message ?? String(error),
            attemptCount: nextAttemptCount,
          },
        });
      }
    })
  );
}

export async function startSyncEngine() {
  const maxBotInfo = await getMaxBotMe();
  console.log(
    `[sync-engine] Max bot connected: user_id=${maxBotInfo?.user_id ?? maxBotInfo?.id ?? "?"}, username=${
      maxBotInfo?.username ?? "(none)"
    }`
  );

  while (true) {
    try {
      await enqueueDueJobs();
      await runWorkerBatch();
    } catch (error) {
      console.error("[sync-engine] loop failure:", error.message);
    }
    await sleep(config.sync.schedulerIntervalMs);
  }
}
