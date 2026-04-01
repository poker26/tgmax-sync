const authPanel = document.getElementById("authPanel");
const appPanel = document.getElementById("appPanel");
const authOutput = document.getElementById("authOutput");
const telegramBotOutput = document.getElementById("telegramBotOutput");
const telegramBotHint = document.getElementById("telegramBotHint");
const logsOutput = document.getElementById("logsOutput");
const channelsContainer = document.getElementById("channelsContainer");
const channelStatusOutput = document.getElementById("channelStatusOutput");
const logsChannelFilter = document.getElementById("logsChannelFilter");
const bootstrapHint = document.getElementById("bootstrapHint");
const registerButton = document.getElementById("registerButton");
const addChannelOutput = document.getElementById("addChannelOutput");

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

async function apiRequest(path, options = {}) {
  const headers = options.headers || {};
  headers["content-type"] = headers["content-type"] || "application/json";
  const token = getToken();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(path, { ...options, headers });
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
    await loadChannels();
    await loadLogs();
  } catch {
    setToken("");
    renderAuthState(false);
  }
}

async function loadBootstrapStatus() {
  try {
    const responseBody = await apiRequest("/api/auth/bootstrap-status", { method: "GET" });
    if (responseBody.bootstrapAllowed) {
      bootstrapHint.textContent = "No users found. Register first user, then login.";
      registerButton.disabled = false;
    } else {
      bootstrapHint.textContent = "Bootstrap disabled: first user already exists.";
      registerButton.disabled = true;
    }
  } catch (error) {
    bootstrapHint.textContent = `Bootstrap status unavailable: ${error.message}`;
    registerButton.disabled = false;
  }
}

document.getElementById("loginButton").addEventListener("click", async () => {
  try {
    const email = document.getElementById("emailInput").value;
    const password = document.getElementById("passwordInput").value;
    const responseBody = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(responseBody.token);
    authOutput.textContent = "Login successful.";
    renderAuthState(true);
    await loadTelegramBotMeta();
    await loadChannels();
    await loadLogs();
  } catch (error) {
    authOutput.textContent = error.message;
  }
});

document.getElementById("registerButton").addEventListener("click", async () => {
  try {
    const email = document.getElementById("emailInput").value;
    const password = document.getElementById("passwordInput").value;
    await apiRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    authOutput.textContent = "First user registered. Now login.";
    await loadBootstrapStatus();
  } catch (error) {
    authOutput.textContent = error.message;
  }
});

async function loadTelegramBotMeta() {
  try {
    const botMeta = await apiRequest("/api/telegram/bot/meta", { method: "GET" });
    telegramBotHint.textContent = `Добавьте ${botMeta.botUsername ?? "бота"} в ваш TG-канал администратором, затем подключите канал.`;
    telegramBotOutput.textContent = JSON.stringify(botMeta, null, 2);
  } catch (error) {
    telegramBotHint.textContent = "Не удалось получить данные Telegram-бота.";
    telegramBotOutput.textContent = error.message;
  }
}

document
  .getElementById("refreshBotMetaButton")
  .addEventListener("click", async () => loadTelegramBotMeta());

document.getElementById("addChannelButton").addEventListener("click", async () => {
  try {
    const sourceChannelId = document.getElementById("sourceChannelInput").value;
    const targetChatId = document.getElementById("targetChatInput").value;
    const pollIntervalMs = Number.parseInt(document.getElementById("pollIntervalInput").value, 10);
    const pollLimit = Number.parseInt(document.getElementById("pollLimitInput").value, 10);
    const createdChannelResponse = await apiRequest("/api/channels", {
      method: "POST",
      body: JSON.stringify({
        sourceChannelId,
        targetChatId,
        pollIntervalMs,
        pollLimit,
      }),
    });
    const channelConfigId = createdChannelResponse?.channel?.id;
    if (channelConfigId) {
      const connectResponse = await apiRequest("/api/telegram/bot/connect-channel", {
        method: "POST",
        body: JSON.stringify({ channelConfigId }),
      });
      addChannelOutput.textContent = `Channel created and bot validated. Status: ${connectResponse.botStatus}`;
    } else {
      addChannelOutput.textContent = "Channel created.";
    }
    await loadChannels();
  } catch (error) {
    addChannelOutput.textContent = error.message;
  }
});

async function setChannelStatus(channelId, status) {
  await apiRequest(`/api/channels/${channelId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  await loadChannels();
}

async function deleteChannel(channelId) {
  await apiRequest(`/api/channels/${channelId}`, { method: "DELETE" });
  await loadChannels();
}

async function loadChannels() {
  const responseBody = await apiRequest("/api/channels", { method: "GET" });
  channelsContainer.innerHTML = "";
  const previousFilterValue = logsChannelFilter.value;
  logsChannelFilter.innerHTML = '<option value="">All channels</option>';
  for (const channel of responseBody.channels) {
    const optionElement = document.createElement("option");
    optionElement.value = channel.id;
    optionElement.textContent = `${channel.source_channel_id} -> ${channel.target_chat_id}`;
    logsChannelFilter.appendChild(optionElement);

    const channelElement = document.createElement("div");
    channelElement.className = "channel";
    channelElement.innerHTML = `
      <div><b>${channel.source_channel_id}</b> -> <b>${channel.target_chat_id}</b></div>
      <div>Status: ${channel.status}</div>
      <div>Source type: ${channel.source_type ?? "telegram_bot_channel"}</div>
      <div>Bot status: ${channel.bot_membership_status ?? "unknown"}</div>
      <div>Poll: ${channel.poll_interval_ms}ms, limit ${channel.poll_limit}</div>
      <button data-action="connect">Validate bot access</button>
      <button data-action="status">Show status</button>
      <button data-action="active">Start</button>
      <button data-action="paused">Pause</button>
      <button data-action="disabled">Disable</button>
      <button data-action="delete">Delete</button>
    `;
    channelElement.querySelectorAll("button").forEach((buttonElement) => {
      buttonElement.addEventListener("click", async () => {
        const action = buttonElement.dataset.action;
        if (action === "connect") {
          await apiRequest("/api/telegram/bot/connect-channel", {
            method: "POST",
            body: JSON.stringify({ channelConfigId: channel.id }),
          });
          await loadChannels();
        } else if (action === "status") {
          const statusPayload = await apiRequest(`/api/channels/${channel.id}/status`, { method: "GET" });
          channelStatusOutput.textContent = JSON.stringify(statusPayload, null, 2);
        } else if (action === "delete") {
          await deleteChannel(channel.id);
        } else {
          await setChannelStatus(channel.id, action);
        }
      });
    });
    channelsContainer.appendChild(channelElement);
  }
  logsChannelFilter.value = previousFilterValue;
}

async function loadLogs() {
  const selectedChannelId = logsChannelFilter.value;
  const logsLimitValue = Number.parseInt(document.getElementById("logsLimitInput").value, 10);
  const safeLimit = Number.isFinite(logsLimitValue) && logsLimitValue > 0 ? logsLimitValue : 200;
  const query = new URLSearchParams();
  query.set("limit", String(safeLimit));
  if (selectedChannelId) {
    query.set("channelId", selectedChannelId);
  }
  const responseBody = await apiRequest(`/api/logs?${query.toString()}`, { method: "GET" });
  logsOutput.textContent = responseBody.logs
    .map((logRow) => `${logRow.created_at} [${logRow.level}] ${logRow.message}`)
    .join("\n");
}

document.getElementById("refreshChannelsButton").addEventListener("click", () => loadChannels());
document.getElementById("refreshLogsButton").addEventListener("click", () => loadLogs());
logsChannelFilter.addEventListener("change", () => loadLogs());

tryRestoreSession();
