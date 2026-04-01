import { config } from "../config.js";
import { withTelegramClient } from "../telegram/client.js";
import { filterImportableMessages, upsertChannelPosts } from "../telegram/import-posts.js";
import {
  buildGroupAnchorMap,
  classifyMediaMessage,
  importMediaMessage,
  loadAlreadyImportedIdentifiers,
} from "../telegram/import-media.js";
import { buildSourcePayloadHash, buildSyncDedupKey } from "./hash.js";
import {
  enqueueSyncEvent,
  loadCursor,
  loadMediaRowsForSourcePosts,
  updateCursor,
} from "./repository.js";

function buildPostPayloadForHash({ message, mediaRows }) {
  return {
    sourceMessageId: Number(message.id),
    text: String(message.text ?? "").trim(),
    date: message.date ? new Date(message.date * 1000).toISOString() : null,
    media: (mediaRows ?? []).map((row) => ({
      objectKey: row.object_key,
      mediaKind: row.media_kind,
      mimeType: row.mime_type,
      sourcePostExternalId: row.source_post_external_id,
    })),
  };
}

export async function collectSyncEvents({ sourceChannelId }) {
  const cursor = await loadCursor(sourceChannelId);
  const lastCursorMessageId = Number(cursor.last_message_id ?? 0);
  const collectedStats = {
    totalMessages: 0,
    newMessages: 0,
    bootstrapSkippedHistory: false,
    importedPosts: 0,
    updatedPosts: 0,
    importedMedia: 0,
    updatedMedia: 0,
    createEvents: 0,
    updateEvents: 0,
    deleteEvents: 0,
  };

  await withTelegramClient(async (client) => {
    const messages = await client.getMessages(sourceChannelId, { limit: config.sync.pollLimit });
    const importableMessages = filterImportableMessages(messages);
    collectedStats.totalMessages = importableMessages.length;
    const allFetchedMessageIds = importableMessages.map((message) => Number(message.id));
    const maxFetchedMessageId = allFetchedMessageIds.length
      ? Math.max(...allFetchedMessageIds)
      : lastCursorMessageId;

    if (lastCursorMessageId === 0 && allFetchedMessageIds.length > 0) {
      collectedStats.bootstrapSkippedHistory = true;
      await updateCursor(sourceChannelId, maxFetchedMessageId);
      return;
    }

    const newMessages = importableMessages.filter(
      (message) => Number(message.id) > lastCursorMessageId
    );
    collectedStats.newMessages = newMessages.length;

    if (newMessages.length === 0) {
      await updateCursor(sourceChannelId, Math.max(lastCursorMessageId, maxFetchedMessageId));
      return;
    }

    const importStats = await upsertChannelPosts(newMessages, sourceChannelId);
    collectedStats.importedPosts = importStats.savedCount;
    collectedStats.updatedPosts = importStats.updatedCount;

    const mediaMessages = newMessages.filter((message) => classifyMediaMessage(message).isSupported);
    const existingIdentifiers = await loadAlreadyImportedIdentifiers(sourceChannelId);
    const groupAnchorMap = buildGroupAnchorMap(newMessages);
    for (const mediaMessage of mediaMessages) {
      const result = await importMediaMessage({
        client,
        message: mediaMessage,
        channelLabel: sourceChannelId,
        existingIdentifiers,
        groupAnchorMap,
      });
      if (result === "imported") collectedStats.importedMedia++;
      if (result === "updated") collectedStats.updatedMedia++;
    }

    const sourceMessageIds = newMessages.map((message) => Number(message.id));
    const sourcePostExternalIds = sourceMessageIds.map((messageId) => String(messageId));
    const mediaRows = await loadMediaRowsForSourcePosts(sourceChannelId, sourcePostExternalIds);
    const mediaBySourcePostExternalId = new Map();
    for (const mediaRow of mediaRows) {
      const sourcePostExternalId = String(mediaRow.source_post_external_id ?? "");
      if (!mediaBySourcePostExternalId.has(sourcePostExternalId)) {
        mediaBySourcePostExternalId.set(sourcePostExternalId, []);
      }
      mediaBySourcePostExternalId.get(sourcePostExternalId).push(mediaRow);
    }

    for (const message of newMessages) {
      const sourceMessageId = Number(message.id);
      const postPayload = buildPostPayloadForHash({
        message,
        mediaRows: mediaBySourcePostExternalId.get(String(sourceMessageId)) ?? [],
      });
      const payloadHash = buildSourcePayloadHash(postPayload);
      const eventType = "create";
      const dedupKey = buildSyncDedupKey({
        sourceChannelId,
        sourceMessageId,
        eventType,
        payloadHash,
      });

      const enqueueResult = await enqueueSyncEvent({
        source_platform: "telegram",
        source_channel_id: sourceChannelId,
        source_message_id: sourceMessageId,
        event_type: eventType,
        payload_hash: payloadHash,
        dedup_key: dedupKey,
        status: "pending",
        next_retry_at: null,
        metadata: { reason: "new_message" },
      });

      if (!enqueueResult.queued) continue;
      collectedStats.createEvents++;
    }

    await updateCursor(sourceChannelId, Math.max(lastCursorMessageId, maxFetchedMessageId));
  });

  return collectedStats;
}
