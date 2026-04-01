import { config } from "../config.js";

function getTelegramBotToken() {
  const token = String(config.telegram.botToken ?? "").trim();
  if (!token) {
    throw new Error("TG_BOT_TOKEN is not configured.");
  }
  return token;
}

function buildTelegramBotApiUrl(pathname, query = {}) {
  const token = getTelegramBotToken();
  const baseUrl = String(config.telegram.botApiBaseUrl ?? "https://api.telegram.org").replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/bot${token}${pathname}`);
  for (const [queryName, queryValue] of Object.entries(query)) {
    if (queryValue == null || queryValue === "") continue;
    url.searchParams.set(queryName, String(queryValue));
  }
  return url;
}

async function requestTelegramBotApi(pathname, { method = "GET", jsonBody = null, query = {} } = {}) {
  const requestUrl = buildTelegramBotApiUrl(pathname, query);
  const response = await fetch(requestUrl, {
    method,
    headers: jsonBody ? { "content-type": "application/json" } : undefined,
    body: jsonBody ? JSON.stringify(jsonBody) : undefined,
  });
  const responsePayload = await response.json().catch(() => null);
  if (!response.ok || !responsePayload?.ok) {
    const description = responsePayload?.description ?? `HTTP ${response.status}`;
    throw new Error(`Telegram Bot API ${pathname} failed: ${description}`);
  }
  return responsePayload.result;
}

export async function getTelegramBotMe() {
  return requestTelegramBotApi("/getMe");
}

export async function getTelegramChat(chatIdentifier) {
  return requestTelegramBotApi("/getChat", {
    method: "POST",
    jsonBody: { chat_id: chatIdentifier },
  });
}

export async function getTelegramChatMember(chatId, userId) {
  return requestTelegramBotApi("/getChatMember", {
    method: "POST",
    jsonBody: {
      chat_id: chatId,
      user_id: userId,
    },
  });
}

export async function getTelegramFile(fileId) {
  return requestTelegramBotApi("/getFile", {
    method: "POST",
    jsonBody: { file_id: fileId },
  });
}

export async function downloadTelegramFileBuffer(filePath) {
  const token = getTelegramBotToken();
  const baseUrl = String(config.telegram.botApiBaseUrl ?? "https://api.telegram.org").replace(/\/+$/, "");
  const fileUrl = `${baseUrl}/file/bot${token}/${String(filePath).replace(/^\/+/, "")}`;
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Telegram file download failed (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function normalizeTelegramChannelPostUpdate(updatePayload) {
  const channelPost = updatePayload?.channel_post ?? null;
  const editedChannelPost = updatePayload?.edited_channel_post ?? null;
  const messageObject = channelPost ?? editedChannelPost;
  if (!messageObject?.chat?.id || !messageObject?.message_id) {
    return null;
  }

  const eventType = channelPost ? "create" : editedChannelPost ? "edit" : "unknown";
  const chatId = String(messageObject.chat.id);
  const chatUsername = messageObject.chat.username ? `@${messageObject.chat.username}` : null;
  const normalizedText = String(messageObject.text ?? messageObject.caption ?? "").trim();
  const largestPhoto = Array.isArray(messageObject.photo)
    ? [...messageObject.photo].sort((leftPhoto, rightPhoto) => {
        return Number(rightPhoto.file_size ?? 0) - Number(leftPhoto.file_size ?? 0);
      })[0]
    : null;

  return {
    updateId: Number(updatePayload.update_id ?? 0),
    eventType,
    chatId,
    chatUsername,
    sourceMessageId: Number(messageObject.message_id),
    messageDateUnix: Number(messageObject.date ?? 0),
    editDateUnix: Number(messageObject.edit_date ?? 0),
    text: normalizedText,
    media: {
      photoFileId: largestPhoto?.file_id ?? null,
      photoMimeType: largestPhoto ? "image/jpeg" : null,
      videoFileId: messageObject.video?.file_id ?? null,
      videoMimeType: messageObject.video?.mime_type ?? "video/mp4",
    },
  };
}
