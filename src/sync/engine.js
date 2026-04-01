import { config } from "../config.js";
import { getMaxBotMe } from "../max/api.js";
import {
  addSyncJobLog,
  claimPendingJobs,
  loadChannelSyncConfigByIdForUser,
  markBotWebhookUpdateFailed,
  markBotWebhookUpdateProcessed,
  markChannelJobError,
  markChannelJobProcessed,
  markSyncJobDone,
  markSyncJobFailed,
} from "../db/multi-tenant-repository.js";
import { processTelegramWebhookSyncJob } from "./bot-webhook-processor.js";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function processSingleJob(syncJob) {
  const configRow = await loadChannelSyncConfigByIdForUser(
    syncJob.user_id,
    syncJob.channel_sync_config_id
  );
  if (!configRow || configRow.status !== "active") {
    throw new Error("Channel sync config is missing, inactive, or not owned by job user.");
  }

  let syncResult;
  if (syncJob.job_type === "telegram_webhook") {
    syncResult = await processTelegramWebhookSyncJob({ syncJob, channelConfig: configRow });
  } else {
    throw new Error(`Unsupported job type: ${syncJob.job_type}`);
  }

  await addSyncJobLog({
    userId: syncJob.user_id,
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
      const startedAtMs = Date.now();
      try {
        await processSingleJob(pendingJob);
        if (pendingJob.job_type === "telegram_webhook" && pendingJob.external_event_id) {
          await markBotWebhookUpdateProcessed(
            pendingJob.channel_sync_config_id,
            Number(pendingJob.external_event_id)
          );
        }
        await markChannelJobProcessed(pendingJob.channel_sync_config_id);
        await markSyncJobDone(pendingJob.id, {
          processingLatencyMs: Date.now() - startedAtMs,
        });
      } catch (error) {
        const nextAttemptCount = Number(pendingJob.attempt_count ?? 0) + 1;
        await markChannelJobError(pendingJob.channel_sync_config_id, error?.message ?? String(error));
        await markSyncJobFailed({
          jobId: pendingJob.id,
          attemptCount: nextAttemptCount,
          maxAttempts: config.sync.maxAttempts,
          errorMessage: error?.message ?? String(error),
        });
        if (pendingJob.job_type === "telegram_webhook" && pendingJob.external_event_id) {
          await markBotWebhookUpdateFailed(
            pendingJob.channel_sync_config_id,
            Number(pendingJob.external_event_id),
            error?.message ?? String(error)
          );
        }
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
      await runWorkerBatch();
    } catch (error) {
      console.error("[sync-engine] loop failure:", error.message);
    }
    await sleep(config.sync.schedulerIntervalMs);
  }
}
