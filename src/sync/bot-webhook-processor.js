import { buildSourcePayloadHash } from "./hash.js";
import { editMessageInMaxChat, publishToMaxChat, uploadMediaToMax } from "../max/api.js";
import {
  getTelegramFile,
  downloadTelegramFileBuffer,
} from "../telegram/bot-api.js";
import {
  loadMappedMessage,
  upsertMappedMessage,
} from "../db/multi-tenant-repository.js";

function pickMediaDescriptor(jobPayload) {
  const photoFileId = jobPayload?.media?.photoFileId ?? null;
  if (photoFileId) {
    return { fileId: photoFileId, mediaKind: "image", mimeType: "image/jpeg", extension: "jpg" };
  }

  const videoFileId = jobPayload?.media?.videoFileId ?? null;
  if (videoFileId) {
    return {
      fileId: videoFileId,
      mediaKind: "video",
      mimeType: jobPayload?.media?.videoMimeType ?? "video/mp4",
      extension: "mp4",
    };
  }
  return null;
}

async function buildMaxAttachmentsFromBotUpdatePayload(jobPayload) {
  const mediaDescriptor = pickMediaDescriptor(jobPayload);
  if (!mediaDescriptor) return [];

  const telegramFile = await getTelegramFile(mediaDescriptor.fileId);
  if (!telegramFile?.file_path) {
    return [];
  }
  const telegramMediaBuffer = await downloadTelegramFileBuffer(telegramFile.file_path);
  const mediaToken = await uploadMediaToMax({
    mediaBuffer: telegramMediaBuffer,
    filename: `${jobPayload.sourceMessageId}.${mediaDescriptor.extension}`,
    mimeType: mediaDescriptor.mimeType,
    mediaKind: mediaDescriptor.mediaKind,
  });
  return [{ mediaKind: mediaDescriptor.mediaKind, token: mediaToken }];
}

export async function processTelegramWebhookSyncJob({ syncJob, channelConfig }) {
  const normalizedPayload = syncJob.payload ?? {};
  const sourceMessageId = Number(syncJob.source_message_id ?? normalizedPayload.sourceMessageId ?? 0);
  if (!sourceMessageId) {
    throw new Error("Webhook job payload does not contain sourceMessageId.");
  }

  const normalizedText = String(normalizedPayload.text ?? "").trim();
  const sourcePayloadHash = buildSourcePayloadHash({
    sourceMessageId,
    text: normalizedText,
    eventType: syncJob.event_type,
    media: normalizedPayload.media ?? {},
  });

  const mappedMessage = await loadMappedMessage({
    userId: syncJob.user_id,
    configId: syncJob.channel_sync_config_id,
    sourceMessageId,
  });

  const maxAttachments = await buildMaxAttachmentsFromBotUpdatePayload(normalizedPayload);
  if (syncJob.event_type === "edit" && mappedMessage?.target_message_id) {
    await editMessageInMaxChat({
      chatId: String(channelConfig.target_chat_id),
      messageId: String(mappedMessage.target_message_id),
      message: normalizedText,
    });
    await upsertMappedMessage({
      userId: syncJob.user_id,
      configId: syncJob.channel_sync_config_id,
      sourceMessageId,
      targetMessageId: mappedMessage.target_message_id,
      sourceHash: sourcePayloadHash,
    });
    return { operation: "edit", sourceMessageId };
  }

  const publishResult = await publishToMaxChat({
    chatId: String(channelConfig.target_chat_id),
    message: normalizedText,
    attachments: maxAttachments,
  });

  await upsertMappedMessage({
    userId: syncJob.user_id,
    configId: syncJob.channel_sync_config_id,
    sourceMessageId,
    targetMessageId: publishResult.messageId,
    sourceHash: sourcePayloadHash,
  });
  return { operation: "create", sourceMessageId };
}
