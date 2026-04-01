import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";
import { config } from "../config.js";

export function createTelegramClient({
  sessionString = config.telegram.session,
  apiId = config.telegram.apiId,
  apiHash = config.telegram.apiHash,
} = {}) {
  return new TelegramClient(
    new StringSession(sessionString),
    apiId,
    apiHash,
    {
      connectionRetries: 5,
      baseLogger: new Logger(LogLevel.ERROR),
    }
  );
}

export async function withTelegramClient(callback, clientOptions = {}) {
  const client = createTelegramClient(clientOptions);
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.disconnect();
  }
}
