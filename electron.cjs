const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  net,
  session: electronSession,
} = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const { fileURLToPath } = require("url");
const { execFile: _execFile } = require("child_process");

const Store = require("electron-store").default;
const { createClient } = require("@supabase/supabase-js");
const { PythonProcessManager } = require("./src/python-process-manager.cjs");
const {
  ScheduleManager,
  SCHEDULE_PRESETS,
} = require("./src/schedule-manager.cjs");
const { DockerCleanupManager } = require("./src/docker-cleanup-manager.cjs");
const { autoUpdater } = require("electron-updater");
const process = require("process");

// --- EXTRACTED MODULES ---
const settings = require("./src/settings.cjs");
const wslUtils = require("./src/wsl-utils.cjs");
const dockerEngine = require("./src/docker-engine.cjs");
const dockerMonitor = require("./src/docker-monitor.cjs");
const engineInstall = require("./src/engine-install.cjs");
const ipcDocker = require("./src/ipc-docker.cjs");
const ipcDeps = require("./src/ipc-deps.cjs");
const { AutoCompactManager } = require("./src/auto-compact-manager.cjs");

function execFilePromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    _execFile(command, args, options, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * PATCH /api/dgn/provider/config to flip the transient `paused_for_compaction`
 * flag. Called by AutoCompactManager around its compaction window so the
 * orchestrator skips this provider while Python is briefly offline.
 */
async function setProviderPausedForCompaction(providerId, paused) {
  if (!providerId) return { success: false, error: "Missing providerId" };
  if (!session) return { success: false, error: "Not authenticated" };

  return new Promise((resolve) => {
    const url = `${ORCHESTRATOR_API_URL}/api/dgn/provider/config?providerId=${encodeURIComponent(
      providerId,
    )}`;
    const request = net.request({ method: "PATCH", url });
    request.setHeader("Authorization", `Bearer ${session.access_token}`);
    request.setHeader("Content-Type", "application/json");
    let body = "";
    request.on("response", (response) => {
      response.on("data", (chunk) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = { success: response.statusCode < 400 };
        }
        if (response.statusCode >= 400) {
          resolve({
            success: false,
            error: parsed?.error || `HTTP ${response.statusCode}`,
          });
        } else {
          resolve({ success: true, data: parsed });
        }
      });
    });
    request.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
    request.write(JSON.stringify({ paused_for_compaction: !!paused }));
    request.end();
  });
}

function mapCleanupPolicy(routingConfig) {
  if (routingConfig?.monetizeMode) return "monetize";
  const mode = routingConfig?.communityMode || "none";
  if (mode === "none") return "mine";
  if (mode === "all") return "all";
  if (mode === "trusted_projects") return "project";
  return "users";
}

async function tryLinuxFallbackOpen(url) {
  const fallbackCommands = [
    ["xdg-open", [url]],
    ["gio", ["open", url]],
    ["sensible-browser", [url]],
  ];

  for (const [command, args] of fallbackCommands) {
    try {
      await execFilePromise(command, args, {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      console.log(`Opened URL with ${command}: ${url}`);
      return;
    } catch (err) {
      console.warn(`Failed to open URL with ${command}: ${err.message}`);
    }
  }

  console.error(`Could not open URL on Linux, no opener succeeded: ${url}`);
  throw new Error("No Linux URL opener succeeded");
}

async function openExternal(url) {
  if (!isAllowedExternalUrl(url)) {
    console.warn(`Blocked external URL: ${url}`);
    return { success: false, error: "URL_NOT_ALLOWED" };
  }

  // On Linux running inside WSL (Windows host), use explorer.exe to open URLs
  // in the host browser. On native Linux, prefer xdg-open/gio directly because
  // shell.openExternal can sometimes appear to succeed without actually opening.
  if (process.platform === "linux" && process.env.OPENFORK_WSL_DISTRO) {
    try {
      await execFilePromise("explorer.exe", [url], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      console.log(
        `Opened URL in Windows host browser via explorer.exe: ${url}`,
      );
      return;
    } catch (err) {
      console.warn(
        "explorer.exe failed to open URL, falling back to Linux opener:",
        err.message,
      );
    }
  }

  if (process.platform === "linux") {
    try {
      await tryLinuxFallbackOpen(url);
      return;
    } catch (err) {
      console.warn(
        `Linux fallback opener failed; trying shell.openExternal: ${err.message}`,
      );
    }
  }

  try {
    await shell.openExternal(url);
    console.log(`Opened external URL: ${url}`);
  } catch (err) {
    console.error(`shell.openExternal failed for URL: ${url}`, err);
    if (process.platform === "linux") {
      await tryLinuxFallbackOpen(url);
    }
  }
}

// --- LINUX APPIMAGE PROTOCOL REGISTRATION ---

/**
 * When running as an AppImage, there is no install step, so the OS never
 * sees a .desktop file and cannot route openfork-desktop-app:// deep links
 * back to the app.  Fix this by writing a .desktop file into the user's
 * local applications directory on first launch and registering it with
 * xdg-mime.  Runs silently on failure — this is best-effort.
 *
 * For .deb installs, electron-builder's postinstall hook calls
 * update-desktop-database automatically, so this function is a no-op there.
 */
async function registerAppImageProtocolHandler() {
  if (process.platform !== "linux") return;

  // APPIMAGE env var is set by the AppImage runtime; absent for deb/rpm installs
  const appImagePath = process.env.APPIMAGE;
  if (!appImagePath) return;

  const desktopDir = path.join(os.homedir(), ".local", "share", "applications");
  const desktopFile = "openfork-client.desktop";
  const desktopFilePath = path.join(desktopDir, desktopFile);
  const iconName = "openfork-client";
  const iconDir = path.join(
    os.homedir(),
    ".local",
    "share",
    "icons",
    "hicolor",
    "512x512",
    "apps",
  );
  const iconPath = path.join(iconDir, `${iconName}.png`);

  const desktopContent =
    [
      "[Desktop Entry]",
      "Name=Openfork Client",
      "Type=Application",
      "Terminal=false",
      `Exec=${appImagePath} %u`,
      `Icon=${iconName}`,
      "MimeType=x-scheme-handler/openfork-desktop-app;",
      "Categories=Network;AudioVideo;",
      "Comment=Collaborative movie creation platform",
    ].join("\n") + "\n";

  try {
    const { promises: fsp } = require("fs");
    await fsp.mkdir(desktopDir, { recursive: true });
    await fsp.mkdir(iconDir, { recursive: true });
    await fsp.copyFile(path.join(__dirname, "dist", "logo.png"), iconPath);
    await fsp.writeFile(desktopFilePath, desktopContent, "utf8");

    await new Promise((resolve) => {
      _execFile(
        "xdg-mime",
        ["default", desktopFile, "x-scheme-handler/openfork-desktop-app"],
        { timeout: 5000 },
        (err) => {
          if (err) console.warn("xdg-mime registration failed:", err.message);
          resolve();
        },
      );
    });

    // Best-effort — not all distros have update-desktop-database
    _execFile(
      "update-desktop-database",
      [desktopDir],
      { timeout: 5000 },
      () => {},
    );

    console.log("Linux AppImage protocol handler registered.");
  } catch (err) {
    console.error("Failed to register AppImage protocol handler:", err.message);
  }
}

// --- LINUX GPU WORKAROUND ---
// On Linux systems without proper EGL/Mesa drivers (e.g. machines with only
// NVIDIA proprietary drivers not yet installed) Electron's GPU process fails
// to initialize and floods the log with EGL errors before falling back to
// software rendering.  Disabling GPU up-front avoids the noise.  Software
// rendering is sufficient for this app's UI.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("disable-gpu");
}

// --- PROTOCOL & INITIALIZATION ---

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("openfork-desktop-app", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("openfork-desktop-app");
}

const store = new Store();
const {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  ORCHESTRATOR_API_URL,
} = require("./config.json");
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: {
      getItem: (key) => store.get(key),
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// --- MODULE INITIALIZATION ---
// Must happen after store is created and before any module functions are called.
settings.init(store);
wslUtils.init({ store, execFile: _execFile });
dockerMonitor.init({
  getMainWindow: () => mainWindow,
  getPythonManager: () => pythonManager,
  getAutoCompactManager: () => autoCompactManager,
  getIsManualReclaimInProgress: () =>
    ipcDocker.isReclaimInProgress?.() === true,
  getIsPostReclaimSettling: () =>
    ipcDocker.isInPostReclaimSettleWindow?.() === true,
});

let mainWindow;
let session = null;
let pythonManager;
let scheduleManager;
let cleanupManager;
let autoCompactManager;
let isQuittingApp = false;
let pendingClientStart = null;
let authStateSubscription = null;
let pendingAuthState = null;
let ipcSenderGuardInstalled = false;
let requiredUpdateState = null;
let requiredUpdateCheckPromise = null;
let appUpdateState = {
  available: null,
  progress: null,
  downloaded: false,
  error: null,
  checking: false,
  lastCheckedAt: null,
};
let appUpdateCheckPromise = null;
let appUpdateCheckInterval = null;
let rendererSecurityHeadersInstalled = false;

const RENDERER_REFRESH_TOKEN_SENTINEL =
  "__openfork_renderer_refresh_token_not_available__";
const APP_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

function sessionForRenderer(authSession) {
  if (!authSession) return null;
  return {
    ...authSession,
    refresh_token: RENDERER_REFRESH_TOKEN_SENTINEL,
  };
}

function sendSessionToRenderer(authSession) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:session", sessionForRenderer(authSession));
  }
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: "GET", url });
    request.setHeader("Accept", "application/json");
    let body = "";
    request.on("response", (response) => {
      response.on("data", (chunk) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        try {
          resolve({
            statusCode: response.statusCode,
            body: body ? JSON.parse(body) : null,
          });
        } catch (err) {
          reject(err);
        }
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function normalizeRequiredUpdatePayload(payload) {
  const evaluation = payload?.evaluation || payload?.required_update || payload;
  if (!evaluation?.required) return null;
  return {
    required: true,
    ...evaluation,
    message:
      evaluation.message ||
      "A required OpenFork update is available. Install it to continue.",
  };
}

function notifyRequiredUpdate(updateInfo) {
  requiredUpdateState = normalizeRequiredUpdatePayload(updateInfo);
  if (requiredUpdateState && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:required", requiredUpdateState);
  }
}

function setAppUpdateState(patch) {
  appUpdateState = {
    ...appUpdateState,
    ...patch,
  };
  return appUpdateState;
}

function sendAppUpdateEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function normalizeAppUpdateError(err) {
  return {
    message: err?.message || "Update failed",
    code: err?.code || "UNKNOWN_ERROR",
  };
}

async function checkForAppUpdate() {
  if (!app.isPackaged) return appUpdateState;
  if (appUpdateCheckPromise) return appUpdateCheckPromise;
  if (appUpdateState.downloaded || appUpdateState.progress) {
    return appUpdateState;
  }

  setAppUpdateState({
    checking: true,
    error: null,
    lastCheckedAt: new Date().toISOString(),
  });

  appUpdateCheckPromise = autoUpdater
    .checkForUpdates()
    .then(() => appUpdateState)
    .catch((err) => {
      const error = normalizeAppUpdateError(err);
      console.error("Failed to check for updates:", err);
      setAppUpdateState({ error, progress: null });
      sendAppUpdateEvent("update:error", error);
      return appUpdateState;
    })
    .finally(() => {
      setAppUpdateState({ checking: false });
      appUpdateCheckPromise = null;
    });

  return appUpdateCheckPromise;
}

function startAppUpdateChecks() {
  if (!app.isPackaged || appUpdateCheckInterval) return;

  checkForAppUpdate().catch((err) => {
    console.error("Failed to start update check:", err);
  });
  appUpdateCheckInterval = setInterval(() => {
    checkForAppUpdate().catch((err) => {
      console.error("Failed to run scheduled update check:", err);
    });
  }, APP_UPDATE_CHECK_INTERVAL_MS);
  appUpdateCheckInterval.unref?.();
}

async function checkRequiredUpdatePolicy() {
  if (requiredUpdateCheckPromise) return requiredUpdateCheckPromise;

  requiredUpdateCheckPromise = (async () => {
    const url = new URL("/api/update-policy", ORCHESTRATOR_API_URL);
    const appVersion = app.getVersion();
    url.searchParams.set("desktopVersion", appVersion);
    url.searchParams.set("clientVersion", appVersion);
    url.searchParams.set("clientKind", "desktop");
    url.searchParams.set("protocolVersion", "1");

    const result = await requestJson(url.toString());
    notifyRequiredUpdate(result.body);
    return requiredUpdateState;
  })()
    .catch((err) => {
      console.warn("Failed to check required update policy:", err?.message || err);
      return requiredUpdateState;
    })
    .finally(() => {
      requiredUpdateCheckPromise = null;
    });

  return requiredUpdateCheckPromise;
}

const SERVICE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMUNITY_MODES = new Set([
  "none",
  "trusted_users",
  "trusted_projects",
  "all",
]);
const EXTERNAL_HTTPS_HOSTS = new Set([
  "openfork.video",
  "www.openfork.video",
  "docker.com",
  "www.docker.com",
  "docs.docker.com",
  "stripe.com",
  "www.stripe.com",
  "checkout.stripe.com",
  "connect.stripe.com",
  "dashboard.stripe.com",
  "billing.stripe.com",
  "github.com",
  "www.github.com",
]);

function getOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getWebsocketOrigin(value) {
  const origin = getOrigin(value);
  if (!origin) return null;

  try {
    const parsed = new URL(origin);
    parsed.protocol = parsed.protocol === "http:" ? "ws:" : "wss:";
    return parsed.origin;
  } catch {
    return null;
  }
}

function getAllowedExternalOrigins() {
  return new Set(
    [getOrigin(ORCHESTRATOR_API_URL), getOrigin(SUPABASE_URL)].filter(Boolean),
  );
}

function isAllowedExternalUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.username || parsed.password) return false;

  const hostname = parsed.hostname.toLowerCase();
  if (
    !app.isPackaged &&
    parsed.protocol === "http:" &&
    (hostname === "localhost" || hostname === "127.0.0.1")
  ) {
    return true;
  }
  if (parsed.protocol !== "https:") return false;
  if (getAllowedExternalOrigins().has(parsed.origin)) return true;
  if (EXTERNAL_HTTPS_HOSTS.has(hostname)) return true;
  if (hostname.endsWith(".stripe.com")) return true;

  return false;
}

function getAllowedRendererOrigins() {
  const origins = new Set();
  if (!app.isPackaged) {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
  }
  return origins;
}

function isTrustedRendererUrl(value) {
  if (!value) return false;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (app.isPackaged) {
    if (parsed.protocol !== "file:") return false;
    try {
      const rendererPath = path.resolve(fileURLToPath(parsed));
      const distPath = path.resolve(__dirname, "dist");
      return rendererPath === path.join(distPath, "index.html");
    } catch {
      return false;
    }
  }

  return getAllowedRendererOrigins().has(parsed.origin);
}

function buildRendererCsp() {
  const isDev = !app.isPackaged;
  const orchestratorOrigin = getOrigin(ORCHESTRATOR_API_URL);
  const supabaseOrigin = getOrigin(SUPABASE_URL);
  const supabaseRealtimeOrigin = getWebsocketOrigin(SUPABASE_URL);
  const connectSrc = [
    "'self'",
    orchestratorOrigin,
    supabaseOrigin,
    supabaseRealtimeOrigin,
    ...(isDev
      ? [
          "http://localhost:*",
          "http://127.0.0.1:*",
          "ws://localhost:*",
          "ws://127.0.0.1:*",
        ]
      : []),
  ].filter(Boolean);
  const scriptSrc = isDev
    ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
    : ["'self'"];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
    `media-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "child-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function setResponseHeader(headers, name, value) {
  const normalizedName = name.toLowerCase();
  const nextHeaders = {};

  for (const [key, headerValue] of Object.entries(headers || {})) {
    if (key.toLowerCase() !== normalizedName) {
      nextHeaders[key] = headerValue;
    }
  }

  nextHeaders[name] = [value];
  return nextHeaders;
}

function installRendererSecurityHeaders() {
  if (rendererSecurityHeadersInstalled) return;
  rendererSecurityHeadersInstalled = true;

  electronSession.defaultSession.webRequest.onHeadersReceived(
    (details, callback) => {
      if (
        details.resourceType !== "mainFrame" ||
        !isTrustedRendererUrl(details.url)
      ) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }

      let responseHeaders = setResponseHeader(
        details.responseHeaders,
        "Content-Security-Policy",
        buildRendererCsp(),
      );
      responseHeaders = setResponseHeader(
        responseHeaders,
        "X-Content-Type-Options",
        "nosniff",
      );
      responseHeaders = setResponseHeader(
        responseHeaders,
        "Referrer-Policy",
        "no-referrer",
      );

      callback({ responseHeaders });
    },
  );
}

function isTrustedIpcSender(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (event.sender !== mainWindow.webContents) return false;

  const frameUrl = event.senderFrame?.url || event.sender.getURL();
  return isTrustedRendererUrl(frameUrl);
}

function installIpcSenderGuard() {
  if (ipcSenderGuardInstalled) return;
  ipcSenderGuardInstalled = true;

  const rawHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) =>
    rawHandle(channel, async (event, ...args) => {
      if (!isTrustedIpcSender(event)) {
        console.warn(`Blocked IPC invoke from untrusted sender: ${channel}`);
        return { success: false, error: "UNTRUSTED_IPC_SENDER" };
      }
      return listener(event, ...args);
    });

  const rawOn = ipcMain.on.bind(ipcMain);
  ipcMain.on = (channel, listener) =>
    rawOn(channel, (event, ...args) => {
      if (!isTrustedIpcSender(event)) {
        console.warn(`Blocked IPC event from untrusted sender: ${channel}`);
        return;
      }
      return listener(event, ...args);
    });
}

function sanitizeRoutingConfig(value = {}) {
  const config = value && typeof value === "object" ? value : {};
  const communityMode = COMMUNITY_MODES.has(config.communityMode)
    ? config.communityMode
    : "none";
  const trustedIds = Array.isArray(config.trustedIds)
    ? config.trustedIds
        .filter((id) => typeof id === "string" && UUID_PATTERN.test(id))
        .slice(0, 500)
    : [];

  return {
    processOwnJobs: config.processOwnJobs === true,
    communityMode,
    trustedIds,
    monetizeMode: config.monetizeMode === true,
  };
}

function isValidServiceId(value) {
  return typeof value === "string" && SERVICE_ID_PATTERN.test(value);
}

function isInvalidSupabaseRefreshTokenError(error) {
  const code = error?.code || error?.error_code;
  const message = error?.message || String(error || "");
  return (
    code === "refresh_token_already_used" ||
    code === "refresh_token_not_found" ||
    message.includes("Invalid Refresh Token") ||
    message.includes("refresh_token_already_used") ||
    message.includes("refresh_token_not_found")
  );
}

async function clearLocalAuthSession(reason, error) {
  const detail = error?.message || error;
  console.warn(detail ? `${reason}: ${detail}` : reason);

  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (signOutError) {
    console.warn(
      "Failed to clear local Supabase session:",
      signOutError?.message || signOutError,
    );
  }

  session = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendSessionToRenderer(null);
    mainWindow.webContents.send("auth:force-logout");
  }
}

// Init modules that need runtime state (mainWindow, pythonManager)
engineInstall.init({
  app,
  getMainWindow: () => mainWindow,
  setWslDistro: wslUtils.setWslDistro,
});
dockerEngine.init({
  getMainWindow: () => mainWindow,
  getInstallState: engineInstall.getCurrentInstallState,
  onWslVhdxLocked: (details) => {
    if (
      ipcDocker.isReclaimInProgress?.() ||
      ipcDocker.isInPostReclaimSettleWindow?.()
    ) {
      return;
    }
    autoCompactManager?.adoptExternalCompaction?.(details);
  },
});

ipcDocker.init({
  app,
  store,
  getMainWindow: () => mainWindow,
  getPythonManager: () => pythonManager,
  getAutoCompactInProgress: () =>
    autoCompactManager?.isCompactionInProgress?.() === true,
  getCurrentProviderId: () => pythonManager?.getCurrentProviderId?.() || null,
  setProviderPausedForCompaction,
  onImageRemoved: (payload) => {
    if (cleanupManager) cleanupManager.notifyImageEvicted(payload);
    if (autoCompactManager) autoCompactManager.notifyImageEvicted(payload);
  },
  onManualCompactCompleted: () => {
    if (autoCompactManager) autoCompactManager.notifyManualCompactCompleted();
  },
  onStorageObserved: (payload) => {
    if (autoCompactManager) autoCompactManager.notifyStorageObserved(payload);
  },
});

ipcDeps.init({
  autoUpdater,
  openExternal,
  getIsCompactionInProgress: () =>
    autoCompactManager?.isCompactionInProgress?.() === true ||
    ipcDocker.isReclaimInProgress?.() === true ||
    ipcDocker.isInPostReclaimSettleWindow?.() === true,
});

function handleSupabaseAuthStateChange(event, newSession) {
  console.log(`Supabase auth event: ${event}`);
  session = newSession;

  if (pythonManager) {
    pythonManager.handleAuthStateChange(event, newSession);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    sendSessionToRenderer(session);

    if (
      event === "SIGNED_OUT" ||
      (event === "TOKEN_REFRESHED" && !newSession)
    ) {
      console.warn(
        "Authentication state changed to unauthenticated, forcing UI refresh",
      );
      mainWindow.webContents.send("auth:force-refresh");
    }
  }
}

function subscribeAuthStateChanges() {
  if (authStateSubscription) return;
  const { data } = supabase.auth.onAuthStateChange(
    handleSupabaseAuthStateChange,
  );
  authStateSubscription = data;
}

// --- AUTHENTICATION ---

async function googleLogin() {
  // Instead of starting an OAuth flow from Electron,
  // we open a page on the website which will handle auth
  // and then redirect back to Electron with the session.
  pendingAuthState = crypto.randomBytes(32).toString("hex");
  const syncUrl = new URL("/auth/electron-login", ORCHESTRATOR_API_URL);
  syncUrl.searchParams.set("desktop_state", pendingAuthState);
  console.log(`Opening auth URL: ${syncUrl.toString()}`);
  return openExternal(syncUrl.toString());
}

async function logout() {
  if (pythonManager) {
    await pythonManager.stop();
  }
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Error logging out:", error.message);
  }
  session = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendSessionToRenderer(null);
  }
}

async function hydrateInitialSession() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    session = data.session;
  } catch (error) {
    if (isInvalidSupabaseRefreshTokenError(error)) {
      await clearLocalAuthSession(
        "Stored Supabase refresh token is invalid. Clearing local session.",
        error,
      );
      return;
    }
    throw error;
  }
}

async function handleAuthCallback(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    console.warn("Blocked malformed auth callback URL.");
    return;
  }

  if (
    parsed.protocol !== "openfork-desktop-app:" ||
    parsed.hostname !== "auth" ||
    parsed.pathname !== "/callback"
  ) {
    console.warn(`Blocked unexpected deep link URL: ${url}`);
    return;
  }

  const params = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const state = params.get("desktop_state");
  if (!pendingAuthState || state !== pendingAuthState) {
    console.warn("Blocked auth callback with missing or invalid state.");
    pendingAuthState = null;
    return;
  }

  pendingAuthState = null;

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) {
    console.warn("Auth callback missing session tokens.");
    return;
  }

  let data;
  let error;
  try {
    const result = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    data = result.data;
    error = result.error;
  } catch (err) {
    error = err;
  }

  if (error) {
    console.error(
      "Failed to set session from auth callback:",
      error?.message || error,
    );
    return;
  }

  session = data.session;
  sendSessionToRenderer(session);
}

// --- APP LIFECYCLE ---

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const url = commandLine.pop();
    if (typeof url === "string" && url.startsWith("openfork-desktop-app://")) {
      handleAuthCallback(url);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    backgroundColor: "#111827",
    icon: path.join(
      __dirname,
      app.isPackaged ? "dist/icon.png" : "public/icon.png",
    ),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });

  // Ensure all target="_blank" links open in the system's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url).catch((err) =>
      console.warn("Failed to open external URL:", err?.message || err),
    );
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    if (!isTrustedRendererUrl(navigationUrl)) {
      console.warn(`Blocked renderer navigation to: ${navigationUrl}`);
      event.preventDefault();
    }
  });

  electronSession.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const allowedPermissions = new Set(["clipboard-read"]);
      const url = webContents.getURL();
      callback(isTrustedRendererUrl(url) && allowedPermissions.has(permission));
    },
  );

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    checkRequiredUpdatePolicy().catch((err) => {
      console.error("Failed to check required update policy:", err);
    });
    startAppUpdateChecks();
  });

  mainWindow.webContents.on("did-finish-load", async () => {
    try {
      await hydrateInitialSession();
    } catch (error) {
      console.error("Failed to hydrate initial session:", error);
      session = null;
    }
    subscribeAuthStateChanges();
    sendSessionToRenderer(session);
  });

  const userDataPath = app.getPath("userData");
  pythonManager = new PythonProcessManager({
    supabase,
    mainWindow,
    userDataPath,
    onJobEvent: (type, payload) => {
      if (!cleanupManager) return;
      if (type === "JOB_START") {
        cleanupManager.notifyJobStart(payload.service_type);
      } else if (
        type === "JOB_COMPLETE" ||
        type === "JOB_FAILED" ||
        type === "JOB_CLEARED"
      ) {
        cleanupManager.notifyJobEnd(payload.service_type);
      }
    },
    onImageEvicted: (payload) => {
      if (cleanupManager) cleanupManager.notifyImageEvicted(payload);
      if (autoCompactManager) autoCompactManager.notifyImageEvicted(payload);
    },
    onDockerDownloadState: (payload) => {
      if (payload?.status !== "completed") return;
      ipcDocker.resetOpenForkImageUsageCache?.();
      setTimeout(() => {
        ipcDocker.refreshOpenForkStorageObservation?.({ forceRefresh: true }).catch(
          (error) => {
            console.warn(
              "Could not refresh OpenFork image cache usage after Docker download:",
              error?.message || error,
            );
          },
        );
      }, 5000);
    },
    onProviderRegistered: (providerId) => {
      if (autoCompactManager)
        autoCompactManager.setCurrentProviderId(providerId);
    },
    orchestratorApiUrl: ORCHESTRATOR_API_URL,
  });

  scheduleManager = new ScheduleManager({ pythonManager, store, mainWindow });
  scheduleManager.loadConfig();

  cleanupManager = new DockerCleanupManager({
    store,
    mainWindow,
  });
  if (cleanupManager.isEnabled()) {
    cleanupManager.startMonitoring();
  }

  autoCompactManager = new AutoCompactManager({
    app,
    store,
    mainWindow,
    pythonManager,
    dockerEngine,
    dockerMonitor,
    wslUtils,
    setProviderPausedForCompaction: setProviderPausedForCompaction,
  });

  mainWindow.on("close", (event) => {
    if (pythonManager && !pythonManager.isQuitting) {
      event.preventDefault();
      app.quit();
    }
  });

  mainWindow.webContents.on("crashed", async (event, killed) => {
    console.error(`Electron: Renderer process crashed. Killed: ${killed}`);
    if (pythonManager) {
      await pythonManager.stop();
    }
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "dist/index.html"));
  } else {
    mainWindow.loadURL("http://localhost:5173");
  }
}

// --- AUTO UPDATER ---
// Registered once at startup so listeners don't accumulate if createWindow()
// is called again (e.g. macOS activate with no open windows).
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on("update-available", (info) => {
  setAppUpdateState({
    available: info,
    progress: null,
    downloaded: false,
    error: null,
  });
  sendAppUpdateEvent("update:available", info);
});

autoUpdater.on("update-not-available", () => {
  if (appUpdateState.downloaded) return;
  setAppUpdateState({
    available: null,
    progress: null,
    downloaded: false,
    error: null,
  });
});

autoUpdater.on("download-progress", (progressObj) => {
  setAppUpdateState({ progress: progressObj });
  sendAppUpdateEvent("update:progress", progressObj);
});

autoUpdater.on("update-downloaded", (info) => {
  setAppUpdateState({
    available: info,
    progress: null,
    downloaded: true,
    error: null,
  });
  sendAppUpdateEvent("update:downloaded", info);
});

autoUpdater.on("error", (err) => {
  console.error("AutoUpdater error:", err);
  const error = normalizeAppUpdateError(err);
  setAppUpdateState({ error, progress: null });
  sendAppUpdateEvent("update:error", error);
});

app.whenReady().then(() => {
  registerAppImageProtocolHandler();
  installRendererSecurityHeaders();
  createWindow();

  // Register IPC handler modules (order doesn't matter here)
  ipcDocker.register(ipcMain);
  ipcDeps.register(ipcMain);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  if (isQuittingApp) return;

  isQuittingApp = true;
  if (pythonManager) {
    pythonManager.isQuitting = true;
  }

  if (appUpdateCheckInterval) {
    clearInterval(appUpdateCheckInterval);
    appUpdateCheckInterval = null;
  }

  // Release the Supabase auth subscription so its internal timers don't
  // keep the event loop alive after we asked the app to quit.
  try {
    authStateSubscription?.subscription?.unsubscribe?.();
  } catch (err) {
    console.warn(
      "Failed to unsubscribe Supabase auth listener:",
      err?.message || err,
    );
  }

  if (!pythonManager || !pythonManager.isRunning()) {
    return;
  }

  console.log("Electron: before-quit event triggered.");
  event.preventDefault();

  await pythonManager.stop();

  console.log("Electron: Backend stopped. Now quitting.");
  app.quit();
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleAuthCallback(url);
});

// --- IPC HANDLERS ---

installIpcSenderGuard();

// Auth
ipcMain.handle("auth:google-login", googleLogin);
ipcMain.handle("auth:logout", logout);
ipcMain.on("auth:force-refresh", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:force-refresh");
  }
});

// Client lifecycle
ipcMain.on("openfork_client:start", async (event, service, routingConfig) => {
  if (!isValidServiceId(service)) {
    console.warn(`Blocked client start with invalid service id: ${service}`);
    return;
  }

  const safeRoutingConfig = sanitizeRoutingConfig(routingConfig);

  if (!pythonManager || pythonManager.isRunning() || pendingClientStart) {
    return;
  }

  const requiredUpdate = await checkRequiredUpdatePolicy();
  if (requiredUpdate?.required) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:required", requiredUpdate);
      mainWindow.webContents.send("openfork_client:log", {
        type: "stderr",
        message: requiredUpdate.message,
      });
      mainWindow.webContents.send("openfork_client:status", "stopped");
    }
    checkForAppUpdate().catch((err) => {
      console.error("Failed to check for required app update:", err);
    });
    return;
  }

  const compactStatus = autoCompactManager
    ? await autoCompactManager.refreshCompactionStatus()
    : null;
  const reclaimStatus = ipcDocker.getReclaimStatus?.();
  const manualReclaimInProgress = reclaimStatus?.inProgress === true;
  const reclaimSettling = ipcDocker.isInPostReclaimSettleWindow?.() === true;
  if (compactStatus?.compactInProgress) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("auto-compact:status", compactStatus);
      mainWindow.webContents.send("openfork_client:log", {
        type: "stderr",
        message:
          "Cannot start DGN client: disk compaction is in progress. Please wait for it to complete.",
      });
      mainWindow.webContents.send("openfork_client:status", "stopped");
    }
    return;
  }
  if (manualReclaimInProgress || reclaimSettling) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (manualReclaimInProgress && reclaimStatus) {
        mainWindow.webContents.send("docker:reclaim-status", reclaimStatus);
      }
      mainWindow.webContents.send("openfork_client:log", {
        type: "stderr",
        message: reclaimSettling
          ? "Cannot start DGN client: OpenFork Ubuntu is reconnecting after disk compaction. Please wait a moment."
          : "Cannot start DGN client: disk compaction is in progress. Please wait for it to complete.",
      });
      mainWindow.webContents.send("openfork_client:status", "stopped");
    }
    return;
  }
  if (pythonManager.isRunning()) {
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("openfork_client:status", "starting");
  }

  pendingClientStart = (async () => {
    let recoveredWslDocker = false;

    if (process.platform === "win32") {
      const wslDistro = await wslUtils.getWslDistroName();
      if (wslDistro) {
        process.env.OPENFORK_WSL_DISTRO = wslDistro;
      } else {
        delete process.env.OPENFORK_WSL_DISTRO;
      }

      let dockerStatus = await dockerEngine.resolveDockerStatus({
        allowNativeStart: false,
      });

      const notifyWslRecoveryStatus = (phase, error) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("docker:wsl-recovery-status", {
            phase,
            error,
            recoveryInProgress: phase !== "completed" && phase !== "failed",
            platformSupported: process.platform === "win32",
          });
        }
      };

      if (
        !dockerStatus.running &&
        dockerStatus.error === "DOCKER_API_UNREACHABLE"
      ) {
        const recoveryMessage =
          "OpenFork Ubuntu is running, but its Docker API is unreachable. Restarting WSL before starting the DGN client...";
        console.warn(recoveryMessage);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("openfork_client:log", {
            type: "stderr",
            message: recoveryMessage,
          });
        }

        try {
          dockerStatus = await dockerEngine.restartWslDockerEngine({
            wslDistro: dockerStatus.wslDistro,
            onPhase: (phase) => notifyWslRecoveryStatus(phase),
          });
          dockerMonitor.resetDockerRoutingCache();
          recoveredWslDocker = true;
          notifyWslRecoveryStatus("restarting_client");
        } catch (err) {
          const message = `Automatic WSL restart failed: ${err?.message || err}`;
          console.error(message);
          notifyWslRecoveryStatus("failed", err?.message || String(err));
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("openfork_client:log", {
              type: "stderr",
              message,
            });
            mainWindow.webContents.send("openfork_client:status", "stopped");
          }
          return;
        }
      }

      if (!dockerStatus.running) {
        const message =
          dockerStatus.error === "WSL_VHDX_LOCKED"
            ? "OpenFork Ubuntu disk is locked by another Windows process. Disk compaction is probably still finishing; please wait and retry."
            : dockerStatus.error === "DOCKER_API_WRONG_DAEMON"
              ? "Windows localhost Docker API is responding from another Docker engine, usually Docker Desktop. Disable Docker Desktop's TCP daemon or repair OpenFork Ubuntu before starting OpenFork."
              : dockerStatus.error === "DOCKER_API_UNREACHABLE"
                ? "OpenFork Ubuntu is running, but its Docker API is not reachable from Windows yet."
                : dockerStatus.error === "WSL_DISTRO_MISSING"
                  ? "OpenFork Ubuntu is missing. Reinstall the local AI engine before starting OpenFork."
                  : "OpenFork Ubuntu is not ready yet. Please retry once the engine is running.";

        console.error(message);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("openfork_client:log", {
            type: "stderr",
            message,
          });
          mainWindow.webContents.send("openfork_client:status", "stopped");
        }
        return;
      }
    }

    await pythonManager.start(service, safeRoutingConfig);

    if (recoveredWslDocker && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("docker:wsl-recovery-status", {
        phase: "completed",
        recoveryInProgress: false,
        platformSupported: process.platform === "win32",
      });
    }

    if (cleanupManager) {
      cleanupManager.updatePolicy(mapCleanupPolicy(safeRoutingConfig));
    }
  })().finally(() => {
    pendingClientStart = null;
  });
});

ipcMain.handle(
  "provider:update-config",
  async (event, providerId, routingConfig) => {
    if (!session) return { success: false, error: "Not authenticated" };
    if (!UUID_PATTERN.test(String(providerId || ""))) {
      return { success: false, error: "Invalid provider id" };
    }
    const safeRoutingConfig = sanitizeRoutingConfig(routingConfig);
    return new Promise((resolve) => {
      const request = net.request({
        method: "PATCH",
        url: `${ORCHESTRATOR_API_URL}/api/dgn/provider/config?providerId=${encodeURIComponent(providerId)}`,
      });
      request.setHeader("Authorization", `Bearer ${session.access_token}`);
      request.setHeader("Content-Type", "application/json");
      let body = "";
      request.on("response", (response) => {
        response.on("data", (chunk) => {
          body += chunk.toString();
        });
        response.on("end", () => {
          let result;
          try {
            result = JSON.parse(body);
          } catch {
            result = { success: response.statusCode < 400 };
          }

          if (typeof result !== "object" || result === null) {
            result = { success: response.statusCode < 400 };
          }
          if (result.success === undefined) {
            result.success = response.statusCode < 400;
          }

          if (result.success && pythonManager) {
            pythonManager.updateRoutingConfig(safeRoutingConfig);
            if (cleanupManager) {
              cleanupManager.updatePolicy(mapCleanupPolicy(safeRoutingConfig));
            }
          }

          resolve(result);
        });
      });
      request.on("error", (err) => {
        console.error("provider:update-config error:", err.message);
        resolve({ success: false, error: err.message });
      });
      const payload = {
        process_own_jobs: safeRoutingConfig.processOwnJobs,
        community_mode: safeRoutingConfig.communityMode,
        allowed_ids: safeRoutingConfig.trustedIds,
        monetize_mode: safeRoutingConfig.monetizeMode,
      };
      request.write(JSON.stringify(payload));
      request.end();
    });
  },
);

ipcMain.on("openfork_client:stop", () => {
  if (pythonManager) pythonManager.stop();
  if (cleanupManager) cleanupManager.resetPolicy();
});

ipcMain.on("docker:cancel-download", (event, serviceType) => {
  if (pythonManager && isValidServiceId(serviceType)) {
    pythonManager.cancelDownload(serviceType);
  }
});

ipcMain.handle("openfork_client:cleanup", async () => {
  if (pythonManager) {
    try {
      await pythonManager.stop();
      await pythonManager.cleanupRogueProcesses();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: "Manager not initialized" };
});

// Window
ipcMain.on("window:set-closable", (event, closable) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setClosable(closable === true);
  }
});

// Info
ipcMain.handle("get-orchestrator-api-url", () => ORCHESTRATOR_API_URL);
ipcMain.handle("update:check-policy", () => checkRequiredUpdatePolicy());
ipcMain.handle("update:check", () => checkForAppUpdate());
ipcMain.handle("update:get-state", () => appUpdateState);
ipcMain.handle("get-process-info", () => ({
  chrome: process.versions.chrome,
  electron: process.versions.electron,
  node: process.versions.node,
  v8: process.versions.v8,
  arch: process.arch,
  platform: process.platform,
  argv: process.argv,
  isPackaged: app.isPackaged,
}));
ipcMain.handle("get-session", async () => sessionForRenderer(session));

// --- MONETIZE / STRIPE IPC HANDLERS ---

function makeAuthenticatedPostRequest(url, payload) {
  return new Promise((resolve) => {
    if (!session) {
      resolve({ error: "Not authenticated" });
      return;
    }
    const request = net.request({ method: "POST", url });
    request.setHeader("Authorization", `Bearer ${session.access_token}`);
    request.setHeader("Content-Type", "application/json");
    let body = "";
    request.on("response", (response) => {
      response.on("data", (chunk) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ error: "Failed to parse response" });
        }
      });
    });
    request.on("error", (err) => resolve({ error: err.message }));
    if (payload !== undefined) {
      request.write(JSON.stringify(payload));
    }
    request.end();
  });
}

ipcMain.on("monetize:start-cleanup", () => {
  if (cleanupManager) {
    cleanupManager.setEnabled(true);
    cleanupManager.startMonitoring();
  }
});

ipcMain.on("monetize:stop-cleanup", () => {
  if (cleanupManager) {
    cleanupManager.setEnabled(false);
    cleanupManager.stopMonitoring();
  }
});

ipcMain.handle("monetize:set-idle-timeout", (event, minutes) => {
  if (cleanupManager) cleanupManager.setIdleTimeoutMinutes(minutes);
  return { success: true };
});

ipcMain.handle("monetize:get-config", () => {
  const saved = store.get("monetizeConfig") || {};
  return {
    idleTimeoutMinutes: saved.idleTimeoutMinutes ?? 30,
    enabled: saved.enabled ?? false,
  };
});

ipcMain.handle("monetize:get-provider-rate", async () => {
  if (!session) return { error: "Not authenticated" };
  return new Promise((resolve) => {
    const request = net.request({
      method: "GET",
      url: `${ORCHESTRATOR_API_URL}/api/dgn/provider/rate`,
    });
    request.setHeader("Authorization", `Bearer ${session.access_token}`);
    let body = "";
    request.on("response", (response) => {
      response.on("data", (chunk) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ error: "Failed to parse response" });
        }
      });
    });
    request.on("error", (err) => resolve({ error: err.message }));
    request.end();
  });
});

ipcMain.handle(
  "monetize:set-provider-rate",
  async (event, rateCentsPerVramGbMin) => {
    if (!session) return { error: "Not authenticated" };
    return new Promise((resolve) => {
      const request = net.request({
        method: "PUT",
        url: `${ORCHESTRATOR_API_URL}/api/dgn/provider/rate`,
      });
      request.setHeader("Authorization", `Bearer ${session.access_token}`);
      request.setHeader("Content-Type", "application/json");
      let body = "";
      request.on("response", (response) => {
        response.on("data", (chunk) => {
          body += chunk.toString();
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({ error: "Failed to parse response" });
          }
        });
      });
      request.on("error", (err) => resolve({ error: err.message }));
      request.write(
        JSON.stringify({ rate_cents_per_vram_gb_min: rateCentsPerVramGbMin }),
      );
      request.end();
    });
  },
);

ipcMain.handle("monetize:open-stripe-onboard", async () => {
  try {
    const data = await makeAuthenticatedPostRequest(
      `${ORCHESTRATOR_API_URL}/api/stripe/connect/onboard`,
    );
    if (data.url) {
      openExternal(data.url);
      return { success: true };
    }
    return { error: data.error || "No URL returned" };
  } catch (err) {
    console.error("Error opening Stripe onboard:", err);
    return { error: err.message };
  }
});

ipcMain.handle("monetize:open-stripe-dashboard", async () => {
  console.log("[Stripe] Opening dashboard, session exists:", !!session);
  try {
    const data = await makeAuthenticatedPostRequest(
      `${ORCHESTRATOR_API_URL}/api/stripe/connect/dashboard`,
    );
    console.log("[Stripe] Dashboard response:", data);
    if (data.url) {
      openExternal(data.url);
      return { success: true };
    }
    return { error: data.error || "No URL returned" };
  } catch (err) {
    console.error("[Stripe] Error opening Stripe dashboard:", err);
    return { error: err.message };
  }
});

ipcMain.handle("monetize:withdraw", async (event, amountMillicents) => {
  try {
    return await makeAuthenticatedPostRequest(
      `${ORCHESTRATOR_API_URL}/api/monetize/withdraw`,
      { amount_millicents: amountMillicents },
    );
  } catch (err) {
    console.error("[Monetize] Error requesting withdrawal:", err);
    return { error: err.message || "Failed to request withdrawal" };
  }
});

ipcMain.on("open-external", (event, url) => {
  openExternal(url).catch((err) =>
    console.warn("Failed to open external URL:", err?.message || err),
  );
});

// Settings persistence
ipcMain.handle("load-settings", async () => {
  try {
    return settings.getAppSettings();
  } catch (error) {
    console.error("Error loading settings:", error);
    return null;
  }
});

ipcMain.handle("save-settings", async (event, newSettings) => {
  try {
    settings.saveAppSettings(newSettings);
    return { success: true };
  } catch (error) {
    console.error("Error saving settings:", error);
    return { success: false, error: error.message };
  }
});

// --- PYTHON CONFIG OVERRIDES IPC HANDLERS ---

const DEFAULT_PYTHON_CONFIG = {
  DOCKER_IMAGE_CACHE_LIMIT_GB: 250,
  POLICY_IDLE_TIMEOUT_MINUTES: {
    monetize: 90,
    all: 120,
    project: 240,
    users: 240,
    mine: null,
  },
  DISK_PRESSURE_HEALTHY_GB: 50,
  DISK_PRESSURE_CRITICAL_GB: 20,
};

function getConfigOverridesPath() {
  return path.join(app.getPath("userData"), "config_overrides.json");
}

function readConfigOverrides() {
  const filePath = getConfigOverridesPath();
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.error("Failed to read config overrides:", e);
  }
  return {};
}

function writeConfigOverrides(overrides) {
  const filePath = getConfigOverridesPath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(overrides, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("Failed to write config overrides:", e);
    return false;
  }
}

function readFiniteInteger(value, fieldName, min, max) {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
  if (value < min || value > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}.`);
  }
  return value;
}

function sanitizePythonConfigPatch(payload, currentConfig) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid Python config payload.");
  }

  const allowedKeys = new Set([
    "DOCKER_IMAGE_CACHE_LIMIT_GB",
    "POLICY_IDLE_TIMEOUT_MINUTES",
    "DISK_PRESSURE_HEALTHY_GB",
    "DISK_PRESSURE_CRITICAL_GB",
  ]);
  const unknownKeys = Object.keys(payload).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`Unsupported Python config key: ${unknownKeys[0]}`);
  }

  const nextConfig = { ...currentConfig };
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(payload, "DOCKER_IMAGE_CACHE_LIMIT_GB")) {
    patch.DOCKER_IMAGE_CACHE_LIMIT_GB = readFiniteInteger(
      payload.DOCKER_IMAGE_CACHE_LIMIT_GB,
      "DOCKER_IMAGE_CACHE_LIMIT_GB",
      50,
      2000,
    );
    nextConfig.DOCKER_IMAGE_CACHE_LIMIT_GB = patch.DOCKER_IMAGE_CACHE_LIMIT_GB;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "DISK_PRESSURE_HEALTHY_GB")) {
    patch.DISK_PRESSURE_HEALTHY_GB = readFiniteInteger(
      payload.DISK_PRESSURE_HEALTHY_GB,
      "DISK_PRESSURE_HEALTHY_GB",
      20,
      500,
    );
    nextConfig.DISK_PRESSURE_HEALTHY_GB = patch.DISK_PRESSURE_HEALTHY_GB;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "DISK_PRESSURE_CRITICAL_GB")) {
    patch.DISK_PRESSURE_CRITICAL_GB = readFiniteInteger(
      payload.DISK_PRESSURE_CRITICAL_GB,
      "DISK_PRESSURE_CRITICAL_GB",
      5,
      500,
    );
    nextConfig.DISK_PRESSURE_CRITICAL_GB = patch.DISK_PRESSURE_CRITICAL_GB;
  }

  if (
    nextConfig.DISK_PRESSURE_CRITICAL_GB >= nextConfig.DISK_PRESSURE_HEALTHY_GB
  ) {
    throw new Error(
      "DISK_PRESSURE_CRITICAL_GB must be lower than DISK_PRESSURE_HEALTHY_GB.",
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, "POLICY_IDLE_TIMEOUT_MINUTES")
  ) {
    const policyPayload = payload.POLICY_IDLE_TIMEOUT_MINUTES;
    if (
      !policyPayload ||
      typeof policyPayload !== "object" ||
      Array.isArray(policyPayload)
    ) {
      throw new Error("POLICY_IDLE_TIMEOUT_MINUTES must be an object.");
    }

    const defaultPolicy = DEFAULT_PYTHON_CONFIG.POLICY_IDLE_TIMEOUT_MINUTES;
    const currentPolicy = currentConfig.POLICY_IDLE_TIMEOUT_MINUTES || {};
    const policyPatch = {};
    for (const [policyName, policyValue] of Object.entries(policyPayload)) {
      if (!Object.prototype.hasOwnProperty.call(defaultPolicy, policyName)) {
        throw new Error(`Unsupported idle timeout policy: ${policyName}`);
      }
      policyPatch[policyName] =
        policyValue === null
          ? null
          : readFiniteInteger(
              policyValue,
              `POLICY_IDLE_TIMEOUT_MINUTES.${policyName}`,
              5,
              1440,
            );
    }

    patch.POLICY_IDLE_TIMEOUT_MINUTES = {
      ...defaultPolicy,
      ...currentPolicy,
      ...policyPatch,
    };
  }

  return patch;
}

ipcMain.handle("python-config:get", () => {
  const overrides = readConfigOverrides();
  return {
    success: true,
    data: {
      ...DEFAULT_PYTHON_CONFIG,
      ...overrides,
    },
    defaults: DEFAULT_PYTHON_CONFIG,
  };
});

ipcMain.handle("python-config:set", (event, payload) => {
  try {
    const overrides = readConfigOverrides();
    const overridePolicy =
      overrides.POLICY_IDLE_TIMEOUT_MINUTES &&
      typeof overrides.POLICY_IDLE_TIMEOUT_MINUTES === "object" &&
      !Array.isArray(overrides.POLICY_IDLE_TIMEOUT_MINUTES)
        ? overrides.POLICY_IDLE_TIMEOUT_MINUTES
        : {};
    const sanitizedPayload = sanitizePythonConfigPatch(payload, {
      ...DEFAULT_PYTHON_CONFIG,
      ...overrides,
      POLICY_IDLE_TIMEOUT_MINUTES: {
        ...DEFAULT_PYTHON_CONFIG.POLICY_IDLE_TIMEOUT_MINUTES,
        ...overridePolicy,
      },
    });
    const merged = { ...overrides, ...sanitizedPayload };
    if (!writeConfigOverrides(merged)) {
      return { success: false, error: "Failed to write overrides file." };
    }
    if (
      payload &&
      Object.prototype.hasOwnProperty.call(
        payload,
        "DOCKER_IMAGE_CACHE_LIMIT_GB",
      )
    ) {
      pythonManager?.updateStorageConfig?.({
        dockerImageCacheLimitGb: sanitizedPayload.DOCKER_IMAGE_CACHE_LIMIT_GB,
      });
    }
    return { success: true };
  } catch (e) {
    console.error("Error setting python config:", e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle("python-config:reset", () => {
  try {
    const filePath = getConfigOverridesPath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (e) {
    console.error("Error resetting python config:", e);
    return { success: false, error: e.message };
  }
});

// --- SCHEDULE MANAGER IPC HANDLERS ---

ipcMain.handle("schedule:get-config", () => {
  return store.get("autoScheduleConfig") || { mode: "manual", schedules: [] };
});

ipcMain.handle("schedule:set-config", (event, config) => {
  try {
    if (scheduleManager) {
      scheduleManager.updateConfig(config);
    }
    return { success: true };
  } catch (error) {
    console.error("Error setting schedule config:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("schedule:get-status", () => {
  if (scheduleManager) {
    return scheduleManager.getStatus();
  }
  return {
    mode: "manual",
    isActive: false,
    message: "Schedule manager not initialized",
  };
});

ipcMain.handle("schedule:get-presets", () => SCHEDULE_PRESETS);

ipcMain.handle("schedule:get-idle-time", () => {
  const { powerMonitor } = require("electron");
  return powerMonitor.getSystemIdleTime();
});

// --- AUTO-COMPACT MANAGER IPC HANDLERS ---

ipcMain.handle("auto-compact:get-status", async () => {
  if (!autoCompactManager) {
    return { enabled: false, platformSupported: process.platform === "win32" };
  }
  try {
    await ipcDocker.refreshOpenForkStorageObservation?.();
  } catch (error) {
    console.warn(
      "Could not refresh storage observation for auto-compact status:",
      error?.message || error,
    );
  }
  return autoCompactManager.getStatus();
});

ipcMain.handle("auto-compact:set-enabled", (event, enabled) => {
  if (autoCompactManager) {
    autoCompactManager.setEnabled(!!enabled);
  }
  return { success: true };
});

ipcMain.handle("auto-compact:set-threshold-gb", (event, gb) => {
  if (autoCompactManager) {
    const bytes = Math.max(1, Number(gb) || 0) * 1024 ** 3;
    autoCompactManager.setThresholdBytes(bytes);
  }
  return { success: true };
});

ipcMain.on("auto-compact:notify-manual-compact", () => {
  if (autoCompactManager) {
    autoCompactManager.notifyManualCompactCompleted();
  }
});

ipcMain.handle("auto-compact:clear-interrupted", () => {
  if (autoCompactManager) {
    autoCompactManager.clearInterruptedCompaction();
  }
  return { success: true };
});

// --- SEARCH & CONFIG IPC HANDLERS ---

ipcMain.handle("search:users", async (event, term) => {
  if (!session) return { success: false, error: "Not authenticated" };
  try {
    const requestUrl = new URL(`${ORCHESTRATOR_API_URL}/api/search/users`);
    requestUrl.searchParams.set("term", term);
    const request = net.request({ method: "GET", url: requestUrl.toString() });
    request.setHeader("Authorization", `Bearer ${session.access_token}`);
    return new Promise((resolve) => {
      let body = "";
      request.on("response", (response) => {
        response.on("data", (chunk) => {
          body += chunk.toString();
        });
        response.on("end", () => {
          if (response.statusCode !== 200) {
            console.error(
              `Search users failed with status ${response.statusCode}: ${body}`,
            );
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            console.error("Failed to parse search users response:", e);
            resolve({
              success: false,
              error: "Failed to parse server response.",
            });
          }
        });
      });
      request.on("error", (error) => {
        console.error("Failed to search users:", error);
        resolve({ success: false, error: "Network request failed." });
      });
      request.end();
    });
  } catch (error) {
    console.error("Error searching users:", error);
    return {
      success: false,
      error: "An unexpected error occurred during search.",
    };
  }
});

ipcMain.handle("search:projects", async (event, term) => {
  if (!session) return { success: false, error: "Not authenticated" };
  try {
    const requestUrl = new URL(`${ORCHESTRATOR_API_URL}/api/search/projects`);
    requestUrl.searchParams.set("term", term);
    const request = net.request({ method: "GET", url: requestUrl.toString() });
    request.setHeader("Authorization", `Bearer ${session.access_token}`);
    return new Promise((resolve) => {
      let body = "";
      request.on("response", (response) => {
        response.on("data", (chunk) => {
          body += chunk.toString();
        });
        response.on("end", () => {
          if (response.statusCode !== 200) {
            console.error(
              `Search projects failed with status ${response.statusCode}: ${body}`,
            );
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            console.error("Failed to parse search projects response:", e);
            resolve({
              success: false,
              error: "Failed to parse server response.",
            });
          }
        });
      });
      request.on("error", (error) => {
        console.error("Failed to search projects:", error);
        resolve({ success: false, error: "Network request failed." });
      });
      request.end();
    });
  } catch (error) {
    console.error("Error searching projects:", error);
    return {
      success: false,
      error: "An unexpected error occurred during search.",
    };
  }
});

ipcMain.handle("fetch:config", async () => {
  try {
    const requestUrl = new URL(`${ORCHESTRATOR_API_URL}/api/config`);
    const request = net.request({ method: "GET", url: requestUrl.toString() });
    return new Promise((resolve) => {
      let body = "";
      request.on("response", (response) => {
        response.on("data", (chunk) => {
          body += chunk.toString();
        });
        response.on("end", () => {
          if (response.statusCode !== 200) {
            console.error(
              `Fetch config failed with status ${response.statusCode}: ${body}`,
            );
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            console.error("Failed to parse config response:", e);
            resolve({});
          }
        });
      });
      request.on("error", (error) => {
        console.error("Failed to fetch config:", error);
        resolve({});
      });
      request.end();
    });
  } catch (error) {
    console.error("Error fetching config:", error);
    return {};
  }
});

ipcMain.handle("search:general", async (event, query) => {
  if (!session) return { success: false, error: "Not authenticated" };
  try {
    const requestUrl = new URL(`${ORCHESTRATOR_API_URL}/api/search`);
    requestUrl.searchParams.set("q", query);
    const request = net.request({ method: "GET", url: requestUrl.toString() });
    return new Promise((resolve) => {
      let body = "";
      request.on("response", (response) => {
        response.on("data", (chunk) => {
          body += chunk.toString();
        });
        response.on("end", () => {
          if (response.statusCode !== 200) {
            console.error(
              `Search general failed with status ${response.statusCode}: ${body}`,
            );
            resolve([]);
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            console.error("Failed to parse search general response:", e);
            resolve([]);
          }
        });
      });
      request.on("error", (error) => {
        console.error("Failed to search general:", error);
        resolve([]);
      });
      request.end();
    });
  } catch (error) {
    console.error("Error searching general:", error);
    return [];
  }
});
