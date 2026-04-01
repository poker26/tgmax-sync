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
  listChannelSyncConfigsByUserId,
  listSyncJobLogsByUser,
  listSyncJobsByUser,
  loadChannelSyncConfigByIdForUser,
  loadTelegramAccountByUserId,
  updateChannelSyncConfigStatus,
  upsertTelegramAccount,
} from "../src/db/multi-tenant-repository.js";
import {
  loginWithEmailPassword,
  logoutByAuthorizationHeader,
  readClientIp,
  registerFirstUser,
  resolveAuthenticatedUser,
} from "../src/auth.js";
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
      response.status(200).json({ ok: true, token: loginResult.token, user: loginResult.user });
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

  app.get("/api/telegram/session", requireAuthenticatedUser, async (request, response) => {
    try {
      const telegramAccount = await loadTelegramAccountByUserId(request.auth.user.id);
      response.status(200).json({
        ok: true,
        hasSession: Boolean(telegramAccount?.session_string),
        status: telegramAccount?.status ?? "missing",
      });
    } catch (error) {
      sendError(response, 500, error.message);
    }
  });

  app.post("/api/telegram/session", requireAuthenticatedUser, async (request, response) => {
    try {
      const sessionString = String(request.body?.sessionString ?? "").trim();
      if (!sessionString) {
        sendError(response, 400, "sessionString is required.");
        return;
      }
      await upsertTelegramAccount({
        userId: request.auth.user.id,
        sessionString,
      });
      response.status(200).json({ ok: true });
    } catch (error) {
      sendError(response, 500, error.message);
    }
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
