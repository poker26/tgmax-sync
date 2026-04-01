const authPanel = document.getElementById("authPanel");
const appPanel = document.getElementById("appPanel");
const authOutput = document.getElementById("authOutput");
const sessionOutput = document.getElementById("sessionOutput");
const logsOutput = document.getElementById("logsOutput");
const channelsContainer = document.getElementById("channelsContainer");
const logsChannelFilter = document.getElementById("logsChannelFilter");
const bootstrapHint = document.getElementById("bootstrapHint");
const registerButton = document.getElementById("registerButton");

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
    authOutput.textContent = responseBody.sessionAttachedFromEnv
      ? "Login successful. Telegram connected automatically."
      : "Login successful.";
    renderAuthState(true);
    await loadChannels();
    await loadLogs();
    const sessionBody = await apiRequest("/api/telegram/session", { method: "GET" });
    sessionOutput.textContent = JSON.stringify(sessionBody, null, 2);
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

document.getElementById("checkSessionButton").addEventListener("click", async () => {
  try {
    const responseBody = await apiRequest("/api/telegram/session", { method: "GET" });
    sessionOutput.textContent = JSON.stringify(responseBody, null, 2);
  } catch (error) {
    sessionOutput.textContent = error.message;
  }
});

document.getElementById("addChannelButton").addEventListener("click", async () => {
  try {
    const sourceChannelId = document.getElementById("sourceChannelInput").value;
    const targetChatId = document.getElementById("targetChatInput").value;
    const pollIntervalMs = Number.parseInt(document.getElementById("pollIntervalInput").value, 10);
    const pollLimit = Number.parseInt(document.getElementById("pollLimitInput").value, 10);
    await apiRequest("/api/channels", {
      method: "POST",
      body: JSON.stringify({
        sourceChannelId,
        targetChatId,
        pollIntervalMs,
        pollLimit,
      }),
    });
    await loadChannels();
  } catch (error) {
    alert(error.message);
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
      <div>Poll: ${channel.poll_interval_ms}ms, limit ${channel.poll_limit}</div>
      <button data-action="active">Start</button>
      <button data-action="paused">Pause</button>
      <button data-action="disabled">Disable</button>
      <button data-action="delete">Delete</button>
    `;
    channelElement.querySelectorAll("button").forEach((buttonElement) => {
      buttonElement.addEventListener("click", async () => {
        const action = buttonElement.dataset.action;
        if (action === "delete") {
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
