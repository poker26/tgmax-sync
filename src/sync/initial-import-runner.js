import path from "path";
import { spawn } from "child_process";
import {
  createInitialImportRun,
  markInitialImportRunFinished,
  markInitialImportRunStarted,
  requestInitialImportRunCancel,
  loadLatestInitialImportRunForConfig,
  updateInitialImportRunProgress,
} from "../db/multi-tenant-repository.js";

const ACTIVE_IMPORTS_BY_CONFIG = new Map();

function normalizeMode(mode) {
  return mode === "test" ? "test" : "full";
}

function buildImportScriptArgs({ channelConfig, mode }) {
  const normalizedMode = normalizeMode(mode);
  const scriptArgs = ["scripts/telegram-to-max.js", "--skip-import", "--max-chat-id", channelConfig.target_chat_id];
  if (normalizedMode === "test") {
    scriptArgs.push("--limit", "5");
    scriptArgs.push("--newest-first");
  } else {
    scriptArgs.push("--limit", "10000");
  }
  scriptArgs.push(channelConfig.source_channel_id);
  return scriptArgs;
}

function cropLogExcerpt(existingLogExcerpt, nextChunk) {
  const mergedLog = `${existingLogExcerpt}${nextChunk}`;
  return mergedLog.slice(-6000);
}

export function createInitialImportManager({ logger = console, tg2maxProjectPath }) {
  async function startImportForChannel({ userId, channelConfig, mode = "full" }) {
    const activeImportEntry = ACTIVE_IMPORTS_BY_CONFIG.get(channelConfig.id);
    if (activeImportEntry) {
      return activeImportEntry.run;
    }

    const latestRun = await loadLatestInitialImportRunForConfig({
      userId,
      configId: channelConfig.id,
    });
    if (latestRun && ["pending", "running"].includes(latestRun.status)) {
      return latestRun;
    }

    const createdRun = await createInitialImportRun({
      userId,
      configId: channelConfig.id,
      mode: normalizeMode(mode),
    });

    const importScriptArgs = buildImportScriptArgs({
      channelConfig,
      mode: createdRun.mode,
    });

    const spawnedProcess = spawn("node", importScriptArgs, {
      cwd: tg2maxProjectPath,
      env: process.env,
      windowsHide: true,
    });

    const entry = {
      run: createdRun,
      channelConfig,
      process: spawnedProcess,
      logExcerpt: "",
      progress: {
        stage: "starting",
        message: "Подготовка первичного переноса.",
      },
    };

    ACTIVE_IMPORTS_BY_CONFIG.set(channelConfig.id, entry);

    const startedRun = await markInitialImportRunStarted({
      runId: createdRun.id,
      processPid: spawnedProcess.pid ?? null,
    });
    entry.run = startedRun;

    await updateInitialImportRunProgress({
      runId: startedRun.id,
      progress: entry.progress,
      logExcerpt: entry.logExcerpt,
    });

    const persistChunkProgress = async (chunk) => {
      entry.logExcerpt = cropLogExcerpt(entry.logExcerpt, chunk);
      entry.progress = {
        stage: "running",
        message: "Идет перенос постов в Max.",
        lastChunkAt: new Date().toISOString(),
      };
      try {
        await updateInitialImportRunProgress({
          runId: startedRun.id,
          progress: entry.progress,
          logExcerpt: entry.logExcerpt,
        });
      } catch (error) {
        logger.warn("[initial-import] progress persist failed:", error.message);
      }
    };

    spawnedProcess.stdout.on("data", (chunk) => {
      void persistChunkProgress(chunk.toString("utf8"));
    });

    spawnedProcess.stderr.on("data", (chunk) => {
      void persistChunkProgress(chunk.toString("utf8"));
    });

    spawnedProcess.on("error", async (error) => {
      try {
        await markInitialImportRunFinished({
          runId: startedRun.id,
          status: "error",
          errorMessage: error.message,
          progress: {
            stage: "error",
            message: "Первичный перенос завершился с ошибкой запуска.",
          },
          logExcerpt: cropLogExcerpt(entry.logExcerpt, `\n[spawn_error] ${error.message}`),
        });
      } finally {
        ACTIVE_IMPORTS_BY_CONFIG.delete(channelConfig.id);
      }
    });

    spawnedProcess.on("close", async (exitCode) => {
      try {
        const latestAfterClose = await loadLatestInitialImportRunForConfig({
          userId,
          configId: channelConfig.id,
        });
        const wasCancelled = Boolean(latestAfterClose?.cancel_requested);
        if (wasCancelled) {
          await markInitialImportRunFinished({
            runId: startedRun.id,
            status: "cancelled",
            progress: {
              stage: "cancelled",
              message: "Первичный перенос остановлен пользователем.",
            },
            logExcerpt: entry.logExcerpt,
          });
          return;
        }

        if (exitCode === 0) {
          await markInitialImportRunFinished({
            runId: startedRun.id,
            status: "done",
            progress: {
              stage: "done",
              message: "Первичный перенос завершен.",
            },
            logExcerpt: entry.logExcerpt,
          });
          return;
        }

        await markInitialImportRunFinished({
          runId: startedRun.id,
          status: "error",
          errorMessage: `Exit code ${exitCode}`,
          progress: {
            stage: "error",
            message: "Первичный перенос завершился с ошибкой.",
          },
          logExcerpt: entry.logExcerpt,
        });
      } catch (error) {
        logger.warn("[initial-import] close handler failed:", error.message);
      } finally {
        ACTIVE_IMPORTS_BY_CONFIG.delete(channelConfig.id);
      }
    });

    return startedRun;
  }

  async function stopImportForChannel({ userId, configId }) {
    const updatedRun = await requestInitialImportRunCancel({ userId, configId });
    const activeImportEntry = ACTIVE_IMPORTS_BY_CONFIG.get(configId);
    if (activeImportEntry?.process && !activeImportEntry.process.killed) {
      activeImportEntry.process.kill("SIGTERM");
    }
    return updatedRun;
  }

  async function getImportStatusForChannel({ userId, configId }) {
    return loadLatestInitialImportRunForConfig({ userId, configId });
  }

  return {
    startImportForChannel,
    stopImportForChannel,
    getImportStatusForChannel,
  };
}

export function resolveDefaultTg2maxProjectPath(basePath) {
  return path.resolve(basePath, "../../tg2max");
}
