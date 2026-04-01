import { publishToMaxChat, uploadMediaToMax } from "../max/api.js";
import { withTelegramClient } from "../telegram/client.js";
import { classifyMediaMessage } from "../telegram/import-media.js";
import { buildSourcePayloadHash } from "./hash.js";
import {
  addSyncJobLog,
  loadMappedMessage,
  loadOrCreateChannelSyncState,
  updateChannelSyncState,
  upsertMappedMessage,
} from "../db/multi-tenant-repository.js";

function fileExtensionForMimeType(mimeType = "", fallback = "bin") {
  const normalizedMimeType = String(mimeType).toLowerCase();
  if (normalizedMimeType.includes("jpeg") || normalizedMimeType.includes("jpg")) return "jpg";
  if (normalizedMimeType.includes("png")) return "png";
  if (normalizedMimeType.includes("gif")) return "gif";
  if (normalizedMimeType.includes("webp")) return "webp";
  if (normalizedMimeType.includes("mp4")) return "mp4";
  return fallback;
}

async function buildAttachmentsFromTelegramMessage(client, telegramMessage) {
  const mediaInfo = classifyMediaMessage(telegramMessage);
  if (!mediaInfo.isSupported) return [];

  const mediaBuffer = await client.downloadMedia(telegramMessage, {});
  if (!mediaBuffer || mediaBuffer.length === 0) return [];

  const mediaToken = await uploadMediaToMax({
    mediaBuffer: Buffer.from(mediaBuffer),
    filename: `${telegramMessage.id}.${fileExtensionForMimeType(mediaInfo.mimeType, mediaInfo.extension)}`,
    mimeType: mediaInfo.mimeType,
    mediaKind: mediaInfo.mediaKind,
  });
  return [{ mediaKind: mediaInfo.mediaKind, token: mediaToken }];
}

export async function processChannelSyncJob({ userId, configId, sourceChannelId, targetChatId, pollLimit, sessionString }) {
  const syncState = await loadOrCreateChannelSyncState({ userId, configId });
  const lastMessageIdFromState = Number(syncState.last_message_id ?? 0);

  return withTelegramClient(
    async (client) => {
      const fetchedMessages = await client.getMessages(sourceChannelId, { limit: pollLimit });
      const importableMessages = (fetchedMessages ?? []).filter((message) => {
        const hasText = String(message?.text ?? "").trim().length > 0;
        const hasMedia = Boolean(message?.media);
        return hasText || hasMedia;
      });
      const fetchedMessageIds = importableMessages.map((message) => Number(message.id));
      const maxFetchedMessageId = fetchedMessageIds.length
        ? Math.max(...fetchedMessageIds)
        : lastMessageIdFromState;

      if (lastMessageIdFromState === 0 && fetchedMessageIds.length > 0) {
        await updateChannelSyncState({
          userId,
          configId,
          lastMessageId: maxFetchedMessageId,
        });
        await addSyncJobLog({
          userId,
          configId,
          level: "info",
          message: "Bootstrap mode: historical messages skipped.",
          details: { maxFetchedMessageId, fetchedCount: fetchedMessageIds.length },
        });
        return { publishedCount: 0, newMessagesCount: 0, bootstrapSkippedHistory: true };
      }

      const newMessages = importableMessages.filter(
        (message) => Number(message.id) > lastMessageIdFromState
      );
      if (newMessages.length === 0) {
        await updateChannelSyncState({
          userId,
          configId,
          lastMessageId: Math.max(lastMessageIdFromState, maxFetchedMessageId),
        });
        return { publishedCount: 0, newMessagesCount: 0, bootstrapSkippedHistory: false };
      }

      const sortedMessages = [...newMessages].sort((leftMessage, rightMessage) => {
        return Number(leftMessage.id) - Number(rightMessage.id);
      });
      let publishedCount = 0;
      for (const newMessage of sortedMessages) {
        const sourceMessageId = Number(newMessage.id);
        const normalizedText = String(newMessage?.text ?? "").trim();
        const sourcePayloadHash = buildSourcePayloadHash({
          sourceMessageId,
          text: normalizedText,
        });
        const existingMapping = await loadMappedMessage({
          userId,
          configId,
          sourceMessageId,
        });
        if (existingMapping?.target_message_id && existingMapping.source_hash === sourcePayloadHash) {
          continue;
        }

        const attachments = await buildAttachmentsFromTelegramMessage(client, newMessage);
        const publishResult = await publishToMaxChat({
          chatId: String(targetChatId),
          message: normalizedText,
          attachments,
        });

        await upsertMappedMessage({
          userId,
          configId,
          sourceMessageId,
          targetMessageId: publishResult.messageId,
          sourceHash: sourcePayloadHash,
        });
        publishedCount++;
      }

      await updateChannelSyncState({
        userId,
        configId,
        lastMessageId: Math.max(lastMessageIdFromState, maxFetchedMessageId),
      });
      return {
        publishedCount,
        newMessagesCount: newMessages.length,
        bootstrapSkippedHistory: false,
      };
    },
    { sessionString }
  );
}
