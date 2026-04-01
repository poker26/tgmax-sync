#!/usr/bin/env node
import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../src/config.js";
import {
  countUsers,
  createChannelSyncConfig,
  deleteChannelSyncConfig,
  enqueueSyncJob,
  listChannelSyncConfigsByUserId,
  listRecentBotWebhookUpdates,
  loadActiveChannelSyncConfigByTelegramChat,
  loadChannelStatusMetrics,
  listSyncJobLogsByUser,
  listSyncJobsByUser,
  markChannelWebhookUpdateSeen,
  loadChannelSyncConfigByIdForUser,
  recordBotWebhookUpdate,
  updateChannelBotConnectionStatus,
  updateChannelSyncConfigStatus,
} from "../src/db/multi-tenant-repository.js";
import {
  loginWithEmailPassword,
  logoutByAuthorizationHeader,
  readClientIp,
  registerFirstUser,
  resolveAuthenticatedUser,
} from "../src/auth.js";
import {
  getTelegramBotMe,
  getTelegramChat,
  getTelegramChatMember,
  normalizeTelegramChannelPostUpdate,
} from "../src/telegram/bot-api.js";
import { startSyncEngine } from "../src/sync/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "../web");

function sendError(response, statusCode, message) {
  response.status(statusCode).json({ ok: false, error: message });
}

function parsePositiveInteger(rawValue, fallbackValue) {
  const parsedValue = Number.parseInt(String(rawValue), 10);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallbackValue;
  }
  return parsedValue;
}

async function requireAuthenticatedUser(request, response, next) {
  try {
    const authState = await resolveAuthenticatedUser(request.headers.authorization);
    if (!authState) {
      sendError(response, 401, "Unauthorized");
      return;
    }
    request.auth = authState;
    next();
  } catch (error) {
    sendError(response, 500, error.message);
  }
}

function createApiServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (request, response) => {
    response.status(200).json({ ok: true, service: "tgmax-sync-web" });
  });

  app.get("/api/auth/bootstrap-status", async (request, response) => {
    try {
      const usersCount = await countUsers();
      response.status(200).json({
        ok: true,
        usersCount,
        bootstrapAllowed: usersCount === 0,
      });
    } catch (error) {
      sendError(response, 500, error.message);
    }
  });

  app.post("/api/auth/register", async (request, response) => {
    try {
      const email = String(request.body?.email ?? "").trim().toLowerCase();
      const password = String(request.body?.password ?? "");
      if (!email || !password || password.length < 8) {
        sendError(response, 400, "Email and password (min 8 chars) are required.");
        return;
      }
      const createdUser = await registerFirstUser({ email, password });
      response.status(201).json({ ok: true, user: createdUser });
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.post("/api/auth/login", async (request, response) => {
    try {
      const email = String(request.body?.email ?? "").trim().toLowerCase();
      const password = String(request.body?.password ?? "");
      if (!email || !password) {
        sendError(response, 400, "Email and password are required.");
        return;
      }
      const loginResult = await loginWithEmailPassword({
        email,
        password,
        userAgent: request.headers["user-agent"] ?? "",
        ipAddress: readClientIp(request),
      });
      if (!loginResult) {
        sendError(response, 401, "Invalid credentials.");
        return;
      }
      response.status(200).json({
        ok: true,
        token: loginResult.token,
        user: loginResult.user,
      });
    } catch (error) {
      sendError(response, 500, error.message);
    }
  });

  app.post("/api/auth/logout", async (request, response) => {
    try {
      await logoutByAuthorizationHeader(request.headers.authorization);
      response.status(200).json({ ok: true });
    } catch (error) {
      sendError(response, 500, error.message);
    }
  });

  app.get("/api/me", requireAuthenticatedUser, async (request, response) => {
    response.status(200).json({ ok: true, user: request.auth.user });
  });

  app.get("/api/channels", requireAuthenticatedUser, async (request, response) => {
    try {
      const configs = await listChannelSyncConfigsByUserId(request.auth.user.id);
      response.status(200).json({ ok: true, channels: configs });
    } catch (error) {
      sendError(response, 500, error.message);
    }
  });

  app.post("/api/channels", requireAuthenticatedUser, async (request, response) => {
    try {
      const sourceChannelId = String(request.body?.sourceChannelId ?? "").trim();
      const targetChatId = String(request.body?.targetChatId ?? "").trim();
      if (!sourceChannelId.startsWith("@")) {
        sendError(response, 400, "sourceChannelId must start with @");
        return;
      }
      if (!/^-?\d+$/.test(targetChatId)) {
        sendError(response, 400, "targetChatId must be numeric.");
        return;
      }
      const createdConfig = await createChannelSyncConfig({
        userId: request.auth.user.id,
        sourceChannelId,
        targetChatId,
        sourceType: "telegram_bot_channel",
        sourceChannelIdentifier: null,
        pollIntervalMs: parsePositiveInteger(request.body?.pollIntervalMs, 30000),
        pollLimit: parsePositiveInteger(request.body?.pollLimit, 200),
      });
      response.status(201).json({ ok: true, channel: createdConfig });
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.patch("/api/channels/:channelId/status", requireAuthenticatedUser, async (request, response) => {
    try {
      const channelConfig = await loadChannelSyncConfigByIdForUser(
        request.auth.user.id,
        request.params.channelId
      );
      if (!channelConfig) {
        sendError(response, 404, "Channel config not found.");
        return;
      }
      const nextStatus = String(request.body?.status ?? "").trim();
      if (!["active", "paused", "disabled"].includes(nextStatus)) {
        sendError(response, 400, "status must be active, paused, or disabled.");
        return;
      }
      const updatedConfig = await updateChannelSyncConfigStatus({
        userId: request.auth.user.id,
        configId: channelConfig.id,
        status: nextStatus,
      });
      response.status(200).json({ ok: true, channel: updatedConfig });
    } catch (error) {
      sendError(response, 500, error.message);
    }
  });

  app.delete("/api/channels/:channelId", requireAuthenticatedUser, async (request, response) => {
    try {
      await deleteChannelSyncConfig({
        userId: request.auth.user.id,
        configId: request.params.channelId,
      });
      response.status(200).json({ ok: true });
    } catch (error) {
      sendError(response, 500, error.message);
    }
  });

  app.get("/api/jobs", requireAuthenticatedUser, async (request, response) => {
    try {
      const jobs = await listSyncJobsByUser({
        userId: request.auth.user.id,
        configId: request.query.channelId ? String(request.query.channelId) : null,
        limit: parsePositiveInteger(request.query.limit, 100),
      });
      response.status(200).json({ ok: true, jobs });
    } catch (error) {
      sendError(response, 500, error.message);
    }
  });

  app.get("/api/logs", requireAuthenticatedUser, async (request, response) => {
    try {
      const logs = await listSyncJobLogsByUser({
        userId: request.auth.user.id,
        configId: request.query.channelId ? String(request.query.channelId) : null,
        limit: parsePositiveInteger(request.query.limit, 200),
      });
      response.status(200).json({ ok: true, logs });
    } catch (error) {
      sendError(response, 500, error.message);
    }
  });

  app.get("/api/telegram/bot/meta", requireAuthenticatedUser, async (request, response) => {
    try {
      const botProfile = await getTelegramBotMe();
      response.status(200).json({
        ok: true,
        botUsername: botProfile?.username ? `@${botProfile.username}` : null,
        botId: botProfile?.id ?? null,
        onboardingHint:
          "Add this bot to your Telegram channel as administrator with permission to post/read channel messages.",
      });
    } catch (error) {
      sendError(response, 500, error.message);
    }
  });

  app.post("/api/telegram/bot/connect-channel", requireAuthenticatedUser, async (request, response) => {
    try {
      const channelConfigId = String(request.body?.channelConfigId ?? "").trim();
      if (!channelConfigId) {
        sendError(response, 400, "channelConfigId is required.");
        return;
      }
      const channelConfig = await loadChannelSyncConfigByIdForUser(request.auth.user.id, channelConfigId);
      if (!channelConfig) {
        sendError(response, 404, "Channel config not found.");
        return;
      }

      const chatData = await getTelegramChat(channelConfig.source_channel_id);
      const botProfile = await getTelegramBotMe();
      const botMember = await getTelegramChatMember(chatData.id, botProfile.id);
      const memberStatus = String(botMember?.status ?? "").toLowerCase();
      const hasRequiredPermissions = memberStatus === "administrator" || memberStatus === "creator";
      const nextStatus = hasRequiredPermissions ? "connected" : "insufficient_rights";
      const normalizedChannelUsername = chatData?.username ? `@${chatData.username}` : channelConfig.source_channel_id;

      const updatedConfig = await updateChannelBotConnectionStatus({
        userId: request.auth.user.id,
        configId: channelConfig.id,
        sourceChannelIdentifier: String(chatData.id),
        sourceChannelId: normalizedChannelUsername,
        botMembershipStatus: nextStatus,
      });
      response.status(200).json({
        ok: true,
        channel: updatedConfig,
        botStatus: nextStatus,
        chatId: String(chatData.id),
      });
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get("/api/telegram/bot/status/:channelConfigId", requireAuthenticatedUser, async (request, response) => {
    try {
      const channelConfig = await loadChannelSyncConfigByIdForUser(
        request.auth.user.id,
        request.params.channelConfigId
      );
      if (!channelConfig) {
        sendError(response, 404, "Channel config not found.");
        return;
      }
      const channelMetrics = await loadChannelStatusMetrics({
        userId: request.auth.user.id,
        configId: channelConfig.id,
      });
      const recentWebhookUpdates = await listRecentBotWebhookUpdates({
        userId: request.auth.user.id,
        configId: channelConfig.id,
        limit: 20,
      });
      response.status(200).json({
        ok: true,
        channel: channelConfig,
        metrics: channelMetrics,
        recentWebhookUpdates,
      });
    } catch (error) {
      sendError(response, 500, error.message);
    }
  });

  app.post("/api/webhooks/telegram", async (request, response) => {
    try {
      const expectedSecret = String(config.telegram.webhookSecret ?? "").trim();
      if (expectedSecret) {
        const receivedSecret = String(
          request.headers["x-telegram-bot-api-secret-token"] ?? ""
        ).trim();
        if (!receivedSecret || receivedSecret !== expectedSecret) {
          sendError(response, 401, "Invalid webhook secret.");
          return;
        }
      }

      const normalizedUpdate = normalizeTelegramChannelPostUpdate(request.body ?? {});
      if (!normalizedUpdate) {
        response.status(200).json({ ok: true, ignored: true, reason: "unsupported_update_type" });
        return;
      }

      const channelConfig = await loadActiveChannelSyncConfigByTelegramChat({
        chatId: normalizedUpdate.chatId,
        chatUsername: normalizedUpdate.chatUsername,
      });
      if (!channelConfig) {
        response.status(200).json({ ok: true, ignored: true, reason: "unknown_channel" });
        return;
      }

      await markChannelWebhookUpdateSeen(channelConfig.id);
      const updateLogResult = await recordBotWebhookUpdate({
        userId: channelConfig.user_id,
        configId: channelConfig.id,
        updateId: normalizedUpdate.updateId,
        sourceMessageId: normalizedUpdate.sourceMessageId,
        eventType: normalizedUpdate.eventType,
        payload: normalizedUpdate,
      });
      if (!updateLogResult.queued) {
        response.status(200).json({ ok: true, ignored: true, reason: "duplicate_update" });
        return;
      }

      await enqueueSyncJob({
        userId: channelConfig.user_id,
        configId: channelConfig.id,
        jobType: "telegram_webhook",
        eventType: normalizedUpdate.eventType,
        sourceMessageId: normalizedUpdate.sourceMessageId,
        externalEventId: String(normalizedUpdate.updateId),
        payload: normalizedUpdate,
      });
      response.status(200).json({ ok: true, queued: true });
    } catch (error) {
      sendError(response, 500, error.message);
    }
  });

  app.get("/api/channels/:channelId/status", requireAuthenticatedUser, async (request, response) => {
    try {
      const channelConfig = await loadChannelSyncConfigByIdForUser(
        request.auth.user.id,
        request.params.channelId
      );
      if (!channelConfig) {
        sendError(response, 404, "Channel config not found.");
        return;
      }
      const channelMetrics = await loadChannelStatusMetrics({
        userId: request.auth.user.id,
        configId: channelConfig.id,
      });
      const recentWebhookUpdates = await listRecentBotWebhookUpdates({
        userId: request.auth.user.id,
        configId: channelConfig.id,
        limit: 30,
      });
      response.status(200).json({
        ok: true,
        channel: channelConfig,
        metrics: channelMetrics,
        recentWebhookUpdates,
      });
    } catch (error) {
      sendError(response, 500, error.message);
    }
  });

  app.get("/", (request, response) => {
    response.sendFile(path.join(webRoot, "index.html"));
  });
  app.use(express.static(webRoot));

  return app;
}

async function main() {
  const app = createApiServer();
  app.listen(config.web.port, () => {
    console.log(`[web] tgmax-sync web API listening on port ${config.web.port}`);
  });
  await startSyncEngine();
}

main().catch((error) => {
  console.error("Fatal web server error:", error.message);
  process.exit(1);
});
