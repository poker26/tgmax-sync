const authPanel = document.getElementById("authPanel");
const appPanel = document.getElementById("appPanel");
const authOutput = document.getElementById("authOutput");
const telegramBotOutput = document.getElementById("telegramBotOutput");
const logsOutput = document.getElementById("logsOutput");
const channelsContainer = document.getElementById("channelsContainer");
const channelStatusOutput = document.getElementById("channelStatusOutput");
const connectionCheckOutput = document.getElementById("connectionCheckOutput");
const addChannelOutput = document.getElementById("addChannelOutput");
const bootstrapHint = document.getElementById("bootstrapHint");
const instructionTip = document.getElementById("instructionTip");
const selectedLinkTitle = document.getElementById("selectedLinkTitle");
const linksEmptyState = document.getElementById("linksEmptyState");
const logsChannelFilter = document.getElementById("logsChannelFilter");
const registerButton = document.getElementById("registerButton");
const initialImportStatusOutput = document.getElementById("initialImportStatusOutput");
const runInitialImportCheckbox = document.getElementById("runInitialImportCheckbox");
const initialImportModeSelect = document.getElementById("initialImportModeSelect");

const state = {
  selectedLinkId: "",
  channels: [],
  initialImportByChannel: {},
  initialImportPollTimer: null,
};

function setStatus(element, text, statusType = "info") {
  element.textContent = text;
  element.classList.remove("success", "error");
  if (statusType === "success") {
    element.classList.add("success");
  }
  if (statusType === "error") {
    element.classList.add("error");
  }
}

function getToken() {
  return localStorage.getItem("tgmax_token") || "";
}

function setToken(token) {
  if (!token) {
    localStorage.removeItem("tgmax_token");
    return;
  }
  localStorage.setItem("tgmax_token", token);
}

function toFriendlyError(error) {
  const errorText = String(error?.message || "").toLowerCase();
  if (errorText.includes("invalid credentials")) {
    return "Неверный email или пароль.";
  }
  if (errorText.includes("email and password")) {
    return "Введите email и пароль.";
  }
  if (errorText.includes("min 8")) {
    return "Пароль должен быть не короче 8 символов.";
  }
  if (errorText.includes("sourcechannelid")) {
    return "Укажите Telegram-канал в формате @название_канала.";
  }
  if (errorText.includes("targetchatid")) {
    return "Укажите корректный numeric chat id канала Max.";
  }
  if (errorText.includes("not connected")) {
    return "Бот Telegram еще не подключен к каналу. Нажмите 'Проверить доступ бота'.";
  }
  if (errorText.includes("unauthorized")) {
    return "Сессия истекла. Войдите заново.";
  }
  if (errorText.includes("уже зарегистрирован")) {
    return "Пользователь с таким email уже зарегистрирован. Просто войдите.";
  }
  if (errorText.includes("registration is disabled")) {
    return "Регистрация временно недоступна. Попробуйте позже.";
  }
  if (errorText.includes("uq_tg_initial_import_run_active")) {
    return "Первичный перенос уже запущен для этой связи.";
  }
  if (errorText.includes("eacces") || errorText.includes("enoent")) {
    return "Не удалось запустить первичный перенос. Проверьте серверные настройки.";
  }
  return "Операция не выполнена. Попробуйте еще раз.";
}

async function apiRequest(path, options = {}) {
  const requestHeaders = options.headers || {};
  requestHeaders["content-type"] = requestHeaders["content-type"] || "application/json";
  const token = getToken();
  if (token) {
    requestHeaders.authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, { ...options, headers: requestHeaders });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body;
}

function renderAuthState(isAuthenticated) {
  authPanel.classList.toggle("hidden", isAuthenticated);
  appPanel.classList.toggle("hidden", !isAuthenticated);
}

function getReadableChannelStatus(status) {
  if (status === "active") return "Запущена";
  if (status === "paused") return "Остановлена";
  return "Отключена";
}

function getReadableInitialImportStatus(run) {
  if (!run) {
    return {
      label: "Не запускался",
      detail: "Первичный перенос можно запустить вручную.",
      statusType: "info",
      isActive: false,
    };
  }
  if (run.status === "pending") {
    return {
      label: "В очереди",
      detail: "Первичный перенос готовится к запуску.",
      statusType: "info",
      isActive: true,
    };
  }
  if (run.status === "running") {
    return {
      label: "Выполняется",
      detail: run.progress_json?.message || "Идет перенос постов в Max.",
      statusType: "info",
      isActive: true,
    };
  }
  if (run.status === "done") {
    return {
      label: "Завершен",
      detail: "Первичный перенос успешно завершен.",
      statusType: "success",
      isActive: false,
    };
  }
  if (run.status === "cancelled") {
    return {
      label: "Остановлен",
      detail: "Первичный перенос остановлен.",
      statusType: "error",
      isActive: false,
    };
  }
  return {
    label: "Ошибка",
    detail: run.error_message || "Первичный перенос завершился с ошибкой.",
    statusType: "error",
    isActive: false,
  };
}

function updateSelectedLinkPanel() {
  const selectedChannel = state.channels.find((channel) => channel.id === state.selectedLinkId);
  if (!selectedChannel) {
    setStatus(selectedLinkTitle, "Выберите связь из списка выше.");
    setStatus(initialImportStatusOutput, "Статус первичного переноса появится после выбора связи.");
    return;
  }
  const readableStatus = getReadableChannelStatus(selectedChannel.status);
  const importRun = state.initialImportByChannel[selectedChannel.id] || null;
  const importStatus = getReadableInitialImportStatus(importRun);
  setStatus(
    selectedLinkTitle,
    `Выбрана связь: ${selectedChannel.source_channel_id} -> ${selectedChannel.target_chat_id}. Статус: ${readableStatus}.`
  );
  setStatus(
    initialImportStatusOutput,
    `Первичный перенос: ${importStatus.label}. ${importStatus.detail}`,
    importStatus.statusType
  );
}

function renderChannels() {
  channelsContainer.innerHTML = "";
  const previousFilterValue = logsChannelFilter.value;
  logsChannelFilter.innerHTML = '<option value="">Все связи</option>';

  if (!state.channels.length) {
    linksEmptyState.classList.remove("hidden");
  } else {
    linksEmptyState.classList.add("hidden");
  }

  state.channels.forEach((channel) => {
    const filterOption = document.createElement("option");
    filterOption.value = channel.id;
    filterOption.textContent = `${channel.source_channel_id} -> ${channel.target_chat_id}`;
    logsChannelFilter.appendChild(filterOption);

    const channelCard = document.createElement("button");
    channelCard.type = "button";
    channelCard.className = "linkCard";
    if (channel.id === state.selectedLinkId) {
      channelCard.classList.add("selected");
    }
    channelCard.innerHTML = `
      <div class="linkTitle">${channel.source_channel_id} -> ${channel.target_chat_id}</div>
      <div class="linkMeta">Состояние: ${channel.status}</div>
      <div class="linkMeta">Доступ Telegram-бота: ${channel.bot_membership_status ?? "не проверен"}</div>
      <div class="linkMeta">Первичный перенос: ${
        getReadableInitialImportStatus(state.initialImportByChannel[channel.id] || null).label
      }</div>
    `;
    channelCard.addEventListener("click", () => {
      selectLink(channel.id);
    });
    channelsContainer.appendChild(channelCard);
  });

  if (previousFilterValue) {
    logsChannelFilter.value = previousFilterValue;
  }
  updateSelectedLinkPanel();
}

function clearInitialImportPolling() {
  if (state.initialImportPollTimer) {
    clearInterval(state.initialImportPollTimer);
    state.initialImportPollTimer = null;
  }
}

function scheduleInitialImportPolling() {
  clearInitialImportPolling();
  state.initialImportPollTimer = setInterval(async () => {
    if (!state.selectedLinkId) {
      return;
    }
    const importRun = state.initialImportByChannel[state.selectedLinkId] || null;
    if (!importRun || !["pending", "running"].includes(importRun.status)) {
      return;
    }
    await refreshInitialImportStatus(state.selectedLinkId, { silent: true });
  }, 4000);
}

async function loadBootstrapStatus() {
  try {
    const bootstrapStatus = await apiRequest("/api/auth/bootstrap-status", { method: "GET" });
    const usersCount = Number(bootstrapStatus.usersCount ?? 0);
    setStatus(
      bootstrapHint,
      usersCount > 0
        ? "Новый пользователь? Нажмите «Создать аккаунт», затем войдите."
        : "Создайте первый аккаунт и войдите в систему."
    );
    registerButton.disabled = false;
  } catch (error) {
    setStatus(bootstrapHint, "Не удалось проверить состояние аккаунтов.", "error");
    registerButton.disabled = false;
  }
}

async function loadTelegramBotMeta() {
  try {
    const botMeta = await apiRequest("/api/telegram/bot/meta", { method: "GET" });
    const botName = botMeta.botUsername || "Telegram-бот";
    setStatus(instructionTip, `Для Telegram используйте ${botName}. Добавьте его администратором канала.`);
    telegramBotOutput.textContent = JSON.stringify(botMeta, null, 2);
  } catch (error) {
    setStatus(instructionTip, "Не удалось получить данные Telegram-бота.", "error");
    telegramBotOutput.textContent = toFriendlyError(error);
  }
}

async function checkConnections() {
  try {
    setStatus(connectionCheckOutput, "Проверяем Telegram и Max...");
    const checkResult = await apiRequest("/api/integration/check", { method: "GET" });
    const statusType = checkResult.overallStatus === "error" ? "error" : checkResult.overallStatus === "warn" ? "info" : "success";
    const message = [
      checkResult.summary,
      `Telegram: ${checkResult.telegram?.text ?? "нет данных"}`,
      `Max: ${checkResult.max?.text ?? "нет данных"}`,
      checkResult.note ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    setStatus(connectionCheckOutput, message, statusType);
  } catch (error) {
    setStatus(connectionCheckOutput, toFriendlyError(error), "error");
  }
}

async function loadChannels() {
  const channelsResponse = await apiRequest("/api/channels", { method: "GET" });
  state.channels = channelsResponse.channels || [];

  if (
    state.selectedLinkId &&
    !state.channels.some((channel) => channel.id === state.selectedLinkId)
  ) {
    state.selectedLinkId = "";
  }

  if (!state.selectedLinkId && state.channels.length > 0) {
    state.selectedLinkId = state.channels[0].id;
  }
  await loadInitialImportStatusesForChannels();
  renderChannels();
  scheduleInitialImportPolling();
}

async function createLink() {
  try {
    const sourceChannelId = document.getElementById("sourceChannelInput").value.trim();
    const targetChatId = document.getElementById("targetChatInput").value.trim();
    const runInitialImport = Boolean(runInitialImportCheckbox.checked);
    const initialImportMode = initialImportModeSelect.value === "test" ? "test" : "full";

    const createResponse = await apiRequest("/api/channels", {
      method: "POST",
      body: JSON.stringify({
        sourceChannelId,
        targetChatId,
        runInitialImport,
        initialImportMode,
      }),
    });

    const newChannelId = createResponse?.channel?.id;
    if (newChannelId) {
      const connectResponse = await apiRequest("/api/telegram/bot/connect-channel", {
        method: "POST",
        body: JSON.stringify({ channelConfigId: newChannelId }),
      });
      const botStatusText =
        connectResponse.botStatus === "connected"
          ? "Доступ бота подтвержден."
          : "Связь создана, но доступ Telegram-бота нужно проверить.";
      const importHint = runInitialImport
        ? "Первичный перенос запущен в фоне."
        : "Первичный перенос можно запустить позже вручную.";
      setStatus(addChannelOutput, `Связь успешно создана. ${botStatusText} ${importHint}`, "success");
      state.selectedLinkId = newChannelId;
      if (createResponse.initialImportRun) {
        state.initialImportByChannel[newChannelId] = createResponse.initialImportRun;
      }
    } else {
      setStatus(addChannelOutput, "Связь создана.", "success");
    }

    await loadChannels();
    await loadLogs();
    scheduleInitialImportPolling();
  } catch (error) {
    setStatus(addChannelOutput, toFriendlyError(error), "error");
  }
}

function selectLink(linkId) {
  state.selectedLinkId = linkId;
  renderChannels();
  scheduleInitialImportPolling();
}

async function setSelectedLinkStatus(nextStatus) {
  if (!state.selectedLinkId) {
    setStatus(channelStatusOutput, "Сначала выберите связь.", "error");
    return;
  }
  try {
    await apiRequest(`/api/channels/${state.selectedLinkId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: nextStatus }),
    });

    const successMessage =
      nextStatus === "active"
        ? "Связь запущена. Новые посты будут переноситься автоматически."
        : "Связь остановлена.";
    setStatus(channelStatusOutput, successMessage, "success");
    await loadChannels();
    await loadLogs();
  } catch (error) {
    setStatus(channelStatusOutput, toFriendlyError(error), "error");
  }
}

async function validateSelectedLinkBotAccess() {
  if (!state.selectedLinkId) {
    setStatus(channelStatusOutput, "Сначала выберите связь.", "error");
    return;
  }
  try {
    const connectResponse = await apiRequest("/api/telegram/bot/connect-channel", {
      method: "POST",
      body: JSON.stringify({ channelConfigId: state.selectedLinkId }),
    });
    const isConnected = connectResponse.botStatus === "connected";
    const message = isConnected
      ? "Доступ Telegram-бота подтвержден."
      : "Доступ Telegram-бота ограничен. Проверьте права администратора в канале.";
    setStatus(channelStatusOutput, message, isConnected ? "success" : "error");
    await loadChannels();
    await loadLogs();
  } catch (error) {
    setStatus(channelStatusOutput, toFriendlyError(error), "error");
  }
}

async function deleteSelectedLink() {
  if (!state.selectedLinkId) {
    setStatus(channelStatusOutput, "Сначала выберите связь.", "error");
    return;
  }

  try {
    await apiRequest(`/api/channels/${state.selectedLinkId}`, { method: "DELETE" });
    setStatus(channelStatusOutput, "Связь удалена.", "success");
    delete state.initialImportByChannel[state.selectedLinkId];
    state.selectedLinkId = "";
    await loadChannels();
    await loadLogs();
  } catch (error) {
    setStatus(channelStatusOutput, toFriendlyError(error), "error");
  }
}

async function refreshInitialImportStatus(channelId, { silent = false } = {}) {
  if (!channelId) return null;
  try {
    const statusResponse = await apiRequest(`/api/channels/${channelId}/initial-import/status`, {
      method: "GET",
    });
    state.initialImportByChannel[channelId] = statusResponse.run || null;
    if (!silent) {
      const importStatus = getReadableInitialImportStatus(statusResponse.run || null);
      setStatus(
        initialImportStatusOutput,
        `Первичный перенос: ${importStatus.label}. ${importStatus.detail}`,
        importStatus.statusType
      );
    }
    renderChannels();
    return statusResponse.run || null;
  } catch (error) {
    if (!silent) {
      setStatus(initialImportStatusOutput, toFriendlyError(error), "error");
    }
    return null;
  }
}

async function loadInitialImportStatusesForChannels() {
  const tasks = state.channels.map(async (channel) => {
    const statusResponse = await apiRequest(`/api/channels/${channel.id}/initial-import/status`, {
      method: "GET",
    });
    state.initialImportByChannel[channel.id] = statusResponse.run || null;
  });
  await Promise.all(tasks);
}

async function startSelectedInitialImport() {
  if (!state.selectedLinkId) {
    setStatus(initialImportStatusOutput, "Сначала выберите связь.", "error");
    return;
  }
  try {
    const selectedMode = initialImportModeSelect.value === "test" ? "test" : "full";
    const startResponse = await apiRequest(
      `/api/channels/${state.selectedLinkId}/initial-import/start`,
      {
        method: "POST",
        body: JSON.stringify({ mode: selectedMode }),
      }
    );
    state.initialImportByChannel[state.selectedLinkId] = startResponse.run || null;
    setStatus(initialImportStatusOutput, "Первичный перенос запущен.", "success");
    renderChannels();
    scheduleInitialImportPolling();
  } catch (error) {
    setStatus(initialImportStatusOutput, toFriendlyError(error), "error");
  }
}

async function stopSelectedInitialImport() {
  if (!state.selectedLinkId) {
    setStatus(initialImportStatusOutput, "Сначала выберите связь.", "error");
    return;
  }
  try {
    const stopResponse = await apiRequest(
      `/api/channels/${state.selectedLinkId}/initial-import/stop`,
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    );
    state.initialImportByChannel[state.selectedLinkId] = stopResponse.run || null;
    setStatus(initialImportStatusOutput, "Запрошена остановка первичного переноса.", "success");
    renderChannels();
  } catch (error) {
    setStatus(initialImportStatusOutput, toFriendlyError(error), "error");
  }
}

async function loadLogs() {
  try {
    const query = new URLSearchParams();
    query.set("limit", "200");
    if (logsChannelFilter.value) {
      query.set("channelId", logsChannelFilter.value);
    }
    const logsResponse = await apiRequest(`/api/logs?${query.toString()}`, { method: "GET" });
    logsOutput.textContent = (logsResponse.logs || [])
      .map((logRow) => `${logRow.created_at} [${logRow.level}] ${logRow.message}`)
      .join("\n");
  } catch (error) {
    logsOutput.textContent = toFriendlyError(error);
  }
}

async function configureTelegramConnection() {
  try {
    await apiRequest("/api/telegram/bot/configure-webhook", {
      method: "POST",
      body: JSON.stringify({}),
    });
    setStatus(connectionCheckOutput, "Telegram-подключение настроено. Можно повторить проверку.", "success");
    await loadTelegramBotMeta();
    await checkConnections();
  } catch (error) {
    setStatus(connectionCheckOutput, toFriendlyError(error), "error");
  }
}

async function logout() {
  try {
    await apiRequest("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
  } catch {
    // intentionally ignored to allow local session cleanup
  }
  setToken("");
  clearInitialImportPolling();
  renderAuthState(false);
}

async function tryRestoreSession() {
  await loadBootstrapStatus();
  const token = getToken();
  if (!token) {
    renderAuthState(false);
    return;
  }

  try {
    await apiRequest("/api/me", { method: "GET" });
    renderAuthState(true);
    await loadTelegramBotMeta();
    await checkConnections();
    await loadChannels();
    await loadLogs();
    scheduleInitialImportPolling();
  } catch {
    setToken("");
    clearInitialImportPolling();
    renderAuthState(false);
  }
}

document.getElementById("loginButton").addEventListener("click", async () => {
  try {
    const email = document.getElementById("emailInput").value.trim().toLowerCase();
    const password = document.getElementById("passwordInput").value;
    const loginResponse = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(loginResponse.token);
    setStatus(authOutput, "Вход выполнен успешно.", "success");
    renderAuthState(true);
    await loadTelegramBotMeta();
    await checkConnections();
    await loadChannels();
    await loadLogs();
  } catch (error) {
    setStatus(authOutput, toFriendlyError(error), "error");
  }
});

document.getElementById("registerButton").addEventListener("click", async () => {
  try {
    const email = document.getElementById("emailInput").value.trim().toLowerCase();
    const password = document.getElementById("passwordInput").value;
    await apiRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setStatus(authOutput, "Аккаунт создан. Теперь нажмите «Войти».", "success");
  } catch (error) {
    setStatus(authOutput, toFriendlyError(error), "error");
  }
});

document.getElementById("logoutButton").addEventListener("click", logout);
document.getElementById("refreshBotMetaButton").addEventListener("click", loadTelegramBotMeta);
document.getElementById("configureWebhookButton").addEventListener("click", configureTelegramConnection);
document.getElementById("checkConnectionsButton").addEventListener("click", checkConnections);
document.getElementById("addChannelButton").addEventListener("click", createLink);
document.getElementById("refreshChannelsButton").addEventListener("click", loadChannels);
document.getElementById("startLinkButton").addEventListener("click", async () => setSelectedLinkStatus("active"));
document.getElementById("stopLinkButton").addEventListener("click", async () => setSelectedLinkStatus("paused"));
document.getElementById("deleteLinkButton").addEventListener("click", deleteSelectedLink);
document
  .getElementById("startInitialImportButton")
  .addEventListener("click", startSelectedInitialImport);
document
  .getElementById("stopInitialImportButton")
  .addEventListener("click", stopSelectedInitialImport);
document
  .getElementById("refreshInitialImportStatusButton")
  .addEventListener("click", async () => refreshInitialImportStatus(state.selectedLinkId));
document
  .getElementById("validateBotAccessButton")
  .addEventListener("click", validateSelectedLinkBotAccess);
document.getElementById("refreshLogsButton").addEventListener("click", loadLogs);
logsChannelFilter.addEventListener("change", loadLogs);

tryRestoreSession();
