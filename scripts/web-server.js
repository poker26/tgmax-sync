#!/usr/bin/env node
import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../src/config.js";
import {
  addSyncJobLog,
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
  markStaleInitialImportRunsAsError,
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
  configureTelegramWebhook,
  getTelegramBotMe,
  getTelegramChat,
  getTelegramChatMember,
  getTelegramWebhookInfo,
  normalizeTelegramChannelPostUpdate,
} from "../src/telegram/bot-api.js";
import { getMaxBotMe } from "../src/max/api.js";
import { startSyncEngine } from "../src/sync/engine.js";
import {
  createInitialImportManager,
  resolveDefaultTg2maxProjectPath,
} from "../src/sync/initial-import-runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "../web");
const initialImportManager = createInitialImportManager({
  logger: console,
  tg2maxProjectPath:
    config.initialImport.tg2maxProjectPath?.trim() || resolveDefaultTg2maxProjectPath(__dirname),
});

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

async function appendChannelDebugLog({
  userId,
  configId,
  level = "info",
  message,
  details = {},
}) {
  try {
    await addSyncJobLog({
      userId,
      configId,
      level,
      message,
      details,
    });
  } catch (error) {
    console.warn("[debug-log] failed to persist channel log:", error.message);
  }
}

function buildWebhookTargetUrl() {
  const configuredBaseUrl = String(config.telegram.webhookPublicUrl ?? "").trim().replace(/\/+$/, "");
  if (!configuredBaseUrl) return "";
  return `${configuredBaseUrl}/api/webhooks/telegram`;
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

  app.get("/api/integration/check", requireAuthenticatedUser, async (request, response) => {
    const integrationState = {
      ok: true,
      overallStatus: "ok",
      summary: "Подключения в порядке.",
      telegram: {
        status: "ok",
        text: "Telegram-бот подключен.",
      },
      max: {
        status: "ok",
        text: "Max-бот подключен.",
      },
      note: "Права Max-бота в конкретном канале проверяются при первой отправке сообщения.",
    };

    try {
      const telegramBotProfile = await getTelegramBotMe();
      const telegramWebhookInfo = await getTelegramWebhookInfo();
      const expectedWebhookUrl = buildWebhookTargetUrl();
      const currentWebhookUrl = String(telegramWebhookInfo?.url ?? "").trim();
      const pendingUpdateCount = Number(telegramWebhookInfo?.pending_update_count ?? 0);
      const lastErrorEpochSeconds = Number(telegramWebhookInfo?.last_error_date ?? 0);
      const nowEpochSeconds = Math.floor(Date.now() / 1000);
      const lastErrorAgeSeconds =
        lastErrorEpochSeconds > 0 ? Math.max(0, nowEpochSeconds - lastErrorEpochSeconds) : null;
      const isRecentWebhookError =
        typeof lastErrorAgeSeconds === "number" && lastErrorAgeSeconds <= 6 * 60 * 60;

      integrationState.telegram.botUsername = telegramBotProfile?.username
        ? `@${telegramBotProfile.username}`
        : null;
      integrationState.telegram.pendingUpdateCount = pendingUpdateCount;

      if (!currentWebhookUrl) {
        integrationState.telegram.status = "warn";
        integrationState.telegram.text =
          "Telegram-бот работает, но входящий адрес еще не настроен. Нажмите кнопку настройки.";
      } else if (expectedWebhookUrl && currentWebhookUrl !== expectedWebhookUrl) {
        integrationState.telegram.status = "warn";
        integrationState.telegram.text =
          "Telegram-бот подключен, но адрес входящих событий отличается от ожидаемого.";
      } else if (telegramWebhookInfo?.last_error_message && (isRecentWebhookError || pendingUpdateCount > 0)) {
        integrationState.telegram.status = "warn";
        integrationState.telegram.text =
          "Telegram-бот подключен, но сейчас есть проблема с доставкой событий. Нажмите кнопку настройки и попробуйте снова.";
      } else {
        integrationState.telegram.text = "Telegram-бот подключен и готов к работе.";
      }
    } catch (error) {
      integrationState.telegram.status = "error";
      integrationState.telegram.text =
        "Не удалось проверить Telegram-бота. Проверьте настройки бота на сервере.";
      integrationState.telegram.details = error.message;
    }

    try {
      const maxBotProfile = await getMaxBotMe();
      integrationState.max.botId = String(maxBotProfile?.user_id ?? maxBotProfile?.id ?? "");
      integrationState.max.text = "Max-бот подключен и отвечает.";
    } catch (error) {
      integrationState.max.status = "error";
      integrationState.max.text = "Не удалось проверить Max-бота. Проверьте токен Max-бота.";
      integrationState.max.details = error.message;
    }

    const statusList = [integrationState.telegram.status, integrationState.max.status];
    if (statusList.includes("error")) {
      integrationState.overallStatus = "error";
      integrationState.summary = "Есть проблема подключения. Исправьте ее и попробуйте снова.";
    } else if (statusList.includes("warn")) {
      integrationState.overallStatus = "warn";
      integrationState.summary = "Подключение частично готово. Нужна небольшая донастройка.";
    }

    response.status(200).json(integrationState);
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
      await appendChannelDebugLog({
        userId: request.auth.user.id,
        configId: createdConfig.id,
        level: "info",
        message: "Channel config created.",
        details: {
          sourceChannelId: createdConfig.source_channel_id,
          targetChatId: createdConfig.target_chat_id,
        },
      });
      const runInitialImport = Boolean(request.body?.runInitialImport);
      const initialImportMode = String(request.body?.initialImportMode ?? "full").trim() === "test"
        ? "test"
        : "full";
      let initialImportRun = null;
      if (runInitialImport) {
        initialImportRun = await initialImportManager.startImportForChannel({
          userId: request.auth.user.id,
          channelConfig: createdConfig,
          mode: initialImportMode,
        });
      }
      response.status(201).json({ ok: true, channel: createdConfig, initialImportRun });
    } catch (error) {
      const rawMessage = String(error?.message ?? "");
      if (
        rawMessage.includes("uq_channel_sync_per_user") ||
        rawMessage.toLowerCase().includes("duplicate key value")
      ) {
        sendError(
          response,
          409,
          "Такая связь уже существует. Выберите другой Telegram-канал или другой Max-канал."
        );
        return;
      }
      sendError(response, 400, rawMessage);
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
      if (nextStatus === "active" && channelConfig.bot_membership_status !== "connected") {
        await appendChannelDebugLog({
          userId: request.auth.user.id,
          configId: channelConfig.id,
          level: "warn",
          message: "Start rejected: Telegram bot is not connected to channel.",
          details: {
            botMembershipStatus: channelConfig.bot_membership_status,
            requestedStatus: nextStatus,
          },
        });
        sendError(response, 400, "Cannot start sync: Telegram bot is not connected to the channel.");
        return;
      }
      const updatedConfig = await updateChannelSyncConfigStatus({
        userId: request.auth.user.id,
        configId: channelConfig.id,
        status: nextStatus,
      });
      await addSyncJobLog({
        userId: request.auth.user.id,
        configId: channelConfig.id,
        level: "info",
        message: `Channel status changed to ${nextStatus}.`,
        details: {
          botMembershipStatus: updatedConfig.bot_membership_status,
        },
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
      const webhookInfo = await getTelegramWebhookInfo();
      response.status(200).json({
        ok: true,
        botUsername: botProfile?.username ? `@${botProfile.username}` : null,
        botId: botProfile?.id ?? null,
        webhook: {
          url: webhookInfo?.url ?? "",
          hasCustomCertificate: Boolean(webhookInfo?.has_custom_certificate),
          pendingUpdateCount: Number(webhookInfo?.pending_update_count ?? 0),
          lastErrorDate: webhookInfo?.last_error_date ?? null,
          lastErrorMessage: webhookInfo?.last_error_message ?? null,
          expectedUrl: buildWebhookTargetUrl(),
        },
        onboardingHint:
          "Add this bot to your Telegram channel as administrator with permission to post/read channel messages.",
      });
    } catch (error) {
      sendError(response, 500, error.message);
    }
  });

  app.post("/api/telegram/bot/configure-webhook", requireAuthenticatedUser, async (request, response) => {
    try {
      const webhookUrl = buildWebhookTargetUrl();
      if (!webhookUrl) {
        sendError(response, 400, "TG_BOT_WEBHOOK_URL is not configured on server.");
        return;
      }
      await configureTelegramWebhook({
        webhookUrl,
        secretToken: config.telegram.webhookSecret,
      });
      const webhookInfo = await getTelegramWebhookInfo();
      response.status(200).json({
        ok: true,
        webhook: webhookInfo,
        message: "Telegram webhook configured successfully.",
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

      await appendChannelDebugLog({
        userId: request.auth.user.id,
        configId: channelConfig.id,
        level: "info",
        message: "Validate bot access started.",
        details: {
          sourceChannelId: channelConfig.source_channel_id,
        },
      });

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
      await appendChannelDebugLog({
        userId: request.auth.user.id,
        configId: channelConfig.id,
        level: hasRequiredPermissions ? "info" : "warn",
        message: `Validate bot access finished with status: ${nextStatus}.`,
        details: {
          chatId: String(chatData.id),
          memberStatus,
        },
      });
      response.status(200).json({
        ok: true,
        channel: updatedConfig,
        botStatus: nextStatus,
        chatId: String(chatData.id),
      });
    } catch (error) {
      console.warn("[connect-channel] failed:", error.message);
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
        console.warn("[telegram-webhook] Unknown channel mapping", {
          chatId: normalizedUpdate.chatId,
          chatUsername: normalizedUpdate.chatUsername,
        });
        response.status(200).json({ ok: true, ignored: true, reason: "unknown_channel" });
        return;
      }

      await markChannelWebhookUpdateSeen(channelConfig.id);
      await appendChannelDebugLog({
        userId: channelConfig.user_id,
        configId: channelConfig.id,
        level: "debug",
        message: "Telegram webhook update received.",
        details: {
          updateId: normalizedUpdate.updateId,
          eventType: normalizedUpdate.eventType,
          sourceMessageId: normalizedUpdate.sourceMessageId,
        },
      });
      const updateLogResult = await recordBotWebhookUpdate({
        userId: channelConfig.user_id,
        configId: channelConfig.id,
        updateId: normalizedUpdate.updateId,
        sourceMessageId: normalizedUpdate.sourceMessageId,
        eventType: normalizedUpdate.eventType,
        payload: normalizedUpdate,
      });
      if (!updateLogResult.queued) {
        await appendChannelDebugLog({
          userId: channelConfig.user_id,
          configId: channelConfig.id,
          level: "debug",
          message: "Telegram webhook duplicate ignored.",
          details: {
            updateId: normalizedUpdate.updateId,
          },
        });
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
      await appendChannelDebugLog({
        userId: channelConfig.user_id,
        configId: channelConfig.id,
        level: "info",
        message: "Telegram webhook update queued for sync.",
        details: {
          updateId: normalizedUpdate.updateId,
          eventType: normalizedUpdate.eventType,
          sourceMessageId: normalizedUpdate.sourceMessageId,
        },
      });
      response.status(200).json({ ok: true, queued: true });
    } catch (error) {
      console.error("[telegram-webhook] failed:", error.message);
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

  app.post(
    "/api/channels/:channelId/initial-import/start",
    requireAuthenticatedUser,
    async (request, response) => {
      try {
        const channelConfig = await loadChannelSyncConfigByIdForUser(
          request.auth.user.id,
          request.params.channelId
        );
        if (!channelConfig) {
          sendError(response, 404, "Channel config not found.");
          return;
        }
        const initialImportMode = String(request.body?.mode ?? "full").trim() === "test" ? "test" : "full";
        const startedRun = await initialImportManager.startImportForChannel({
          userId: request.auth.user.id,
          channelConfig,
          mode: initialImportMode,
        });
        response.status(200).json({ ok: true, run: startedRun });
      } catch (error) {
        sendError(response, 400, error.message);
      }
    }
  );

  app.post(
    "/api/channels/:channelId/initial-import/stop",
    requireAuthenticatedUser,
    async (request, response) => {
      try {
        const channelConfig = await loadChannelSyncConfigByIdForUser(
          request.auth.user.id,
          request.params.channelId
        );
        if (!channelConfig) {
          sendError(response, 404, "Channel config not found.");
          return;
        }
        const stopResult = await initialImportManager.stopImportForChannel({
          userId: request.auth.user.id,
          configId: channelConfig.id,
        });
        response.status(200).json({ ok: true, run: stopResult });
      } catch (error) {
        sendError(response, 400, error.message);
      }
    }
  );

  app.get(
    "/api/channels/:channelId/initial-import/status",
    requireAuthenticatedUser,
    async (request, response) => {
      try {
        const channelConfig = await loadChannelSyncConfigByIdForUser(
          request.auth.user.id,
          request.params.channelId
        );
        if (!channelConfig) {
          sendError(response, 404, "Channel config not found.");
          return;
        }
        const importStatus = await initialImportManager.getImportStatusForChannel({
          userId: request.auth.user.id,
          configId: channelConfig.id,
        });
        response.status(200).json({ ok: true, run: importStatus });
      } catch (error) {
        sendError(response, 500, error.message);
      }
    }
  );

  app.get("/", (request, response) => {
    response.sendFile(path.join(webRoot, "index.html"));
  });
  app.use(express.static(webRoot));

  return app;
}

async function main() {
  await markStaleInitialImportRunsAsError();
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
