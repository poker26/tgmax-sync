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

const state = {
  selectedLinkId: "",
  channels: [],
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

function updateSelectedLinkPanel() {
  const selectedChannel = state.channels.find((channel) => channel.id === state.selectedLinkId);
  if (!selectedChannel) {
    setStatus(selectedLinkTitle, "Выберите связь из списка выше.");
    return;
  }
  const readableStatus =
    selectedChannel.status === "active"
      ? "Запущена"
      : selectedChannel.status === "paused"
        ? "Остановлена"
        : "Отключена";
  setStatus(
    selectedLinkTitle,
    `Выбрана связь: ${selectedChannel.source_channel_id} -> ${selectedChannel.target_chat_id}. Статус: ${readableStatus}.`
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

async function loadBootstrapStatus() {
  try {
    const bootstrapStatus = await apiRequest("/api/auth/bootstrap-status", { method: "GET" });
    if (bootstrapStatus.bootstrapAllowed) {
      setStatus(
        bootstrapHint,
        "Первый пользователь еще не создан. Нажмите «Создать первый аккаунт»."
      );
      registerButton.disabled = false;
    } else {
      setStatus(bootstrapHint, "Аккаунт уже создан. Используйте обычный вход.");
      registerButton.disabled = true;
    }
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

  renderChannels();
}

async function createLink() {
  try {
    const sourceChannelId = document.getElementById("sourceChannelInput").value.trim();
    const targetChatId = document.getElementById("targetChatInput").value.trim();

    const createResponse = await apiRequest("/api/channels", {
      method: "POST",
      body: JSON.stringify({
        sourceChannelId,
        targetChatId,
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
      setStatus(addChannelOutput, `Связь успешно создана. ${botStatusText}`, "success");
      state.selectedLinkId = newChannelId;
    } else {
      setStatus(addChannelOutput, "Связь создана.", "success");
    }

    await loadChannels();
    await loadLogs();
  } catch (error) {
    setStatus(addChannelOutput, toFriendlyError(error), "error");
  }
}

function selectLink(linkId) {
  state.selectedLinkId = linkId;
  renderChannels();
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
    state.selectedLinkId = "";
    await loadChannels();
    await loadLogs();
  } catch (error) {
    setStatus(channelStatusOutput, toFriendlyError(error), "error");
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
  } catch {
    setToken("");
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
    setStatus(authOutput, "Аккаунт создан. Теперь войдите в систему.", "success");
    await loadBootstrapStatus();
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
  .getElementById("validateBotAccessButton")
  .addEventListener("click", validateSelectedLinkBotAccess);
document.getElementById("refreshLogsButton").addEventListener("click", loadLogs);
logsChannelFilter.addEventListener("change", loadLogs);

tryRestoreSession();
