const { app, BrowserWindow, ipcMain, shell, net } = require("electron");
const path = require("path");
const os = require("os");
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
}

async function openExternal(url) {
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
      `Exec=${appImagePath} --no-sandbox %u`,
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
  SUPABASE_ANON_KEY,
  ORCHESTRATOR_API_URL,
} = require("./config.json");
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
dockerEngine.init({ getMainWindow: () => mainWindow });
dockerMonitor.init({ getMainWindow: () => mainWindow });

let mainWindow;
let session = null;
let pythonManager;
let scheduleManager;
let cleanupManager;
let autoCompactManager;
let isQuittingApp = false;
let pendingClientStart = null;

// Init modules that need runtime state (mainWindow, pythonManager)
engineInstall.init({
  app,
  getMainWindow: () => mainWindow,
  setWslDistro: wslUtils.setWslDistro,
});
dockerEngine.init({
  getMainWindow: () => mainWindow,
  getInstallState: engineInstall.getCurrentInstallState,
});

ipcDocker.init({
  app,
  getPythonManager: () => pythonManager,
});

ipcDeps.init({
  autoUpdater,
  openExternal,
});

// Listen for auth events to keep the session fresh
const { data: authStateSubscription } = supabase.auth.onAuthStateChange(
  (event, newSession) => {
    console.log(`Supabase auth event: ${event}`);
    session = newSession;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("auth:session", session);

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
  },
);

// --- AUTHENTICATION ---

async function googleLogin() {
  // Instead of starting an OAuth flow from Electron,
  // we open a page on the website which will handle auth
  // and then redirect back to Electron with the session.
  const syncUrl = `${ORCHESTRATOR_API_URL}/auth/electron-login`;
  console.log(`Opening auth URL: ${syncUrl}`);
  return openExternal(syncUrl);
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
    mainWindow.webContents.send("auth:session", null);
  }
}

async function hydrateInitialSession() {
  try {
    const { data } = await supabase.auth.getSession();
    session = data.session;
  } catch (error) {
    const message = error?.message || String(error);
    if (
      message.includes("Invalid Refresh Token") ||
      message.includes("refresh_token_not_found")
    ) {
      console.warn(
        "Stored Supabase refresh token is invalid. Clearing local session.",
      );
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch (signOutError) {
        console.warn(
          "Failed to clear local session after invalid refresh token:",
          signOutError?.message || signOutError,
        );
      }
      session = null;
      return;
    }
    throw error;
  }
}

function handleAuthCallback(url) {
  if (mainWindow) {
    mainWindow.webContents.send("auth:callback", url);
  }
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
    if (url.startsWith("openfork-desktop-app://")) {
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
      webSecurity: true,
    },
  });

  // Ensure all target="_blank" links open in the system's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error("Failed to check for updates:", err);
    });
  });

  mainWindow.webContents.on("did-finish-load", async () => {
    try {
      await hydrateInitialSession();
    } catch (error) {
      console.error("Failed to hydrate initial session:", error);
      session = null;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("auth:session", session);
    }
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
    onProviderRegistered: (providerId) => {
      if (autoCompactManager) autoCompactManager.setCurrentProviderId(providerId);
    },
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:available", info);
  }
});

autoUpdater.on("download-progress", (progressObj) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:progress", progressObj);
  }
});

autoUpdater.on("update-downloaded", (info) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:downloaded", info);
  }
});

autoUpdater.on("error", (err) => {
  console.error("AutoUpdater error:", err);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:error", {
      message: err.message || "Update failed",
      code: err.code || "UNKNOWN_ERROR",
    });
  }
});

app.whenReady().then(() => {
  registerAppImageProtocolHandler();
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

// Auth
ipcMain.handle("auth:google-login", googleLogin);
ipcMain.handle("auth:logout", logout);
ipcMain.on("auth:force-refresh", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:force-refresh");
  }
});
ipcMain.handle(
  "auth:set-session-from-tokens",
  async (event, accessToken, refreshToken) => {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      console.error("Failed to set session in main:", error.message);
      return { session: null, error };
    }

    session = data.session;
    return { session: data.session, error: null };
  },
);

// Client lifecycle
ipcMain.on("openfork_client:start", async (event, service, routingConfig) => {
  if (!pythonManager || pythonManager.isRunning() || pendingClientStart) {
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("openfork_client:status", "starting");
  }

  pendingClientStart = (async () => {
    if (process.platform === "win32") {
      const wslDistro = await wslUtils.getWslDistroName();
      if (wslDistro) {
        process.env.OPENFORK_WSL_DISTRO = wslDistro;
      } else {
        delete process.env.OPENFORK_WSL_DISTRO;
      }

      const dockerStatus = await dockerEngine.resolveDockerStatus({
        allowNativeStart: false,
      });
      if (!dockerStatus.running) {
        const message =
          dockerStatus.error === "DOCKER_API_UNREACHABLE"
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

    await pythonManager.start(service, routingConfig);

    if (cleanupManager) {
      const mode = routingConfig?.communityMode || "none";
      const legacyPolicy =
        mode === "none" ? "mine" : mode === "all" ? "all" : "users";
      cleanupManager.updatePolicy(legacyPolicy);
    }
  })().finally(() => {
    pendingClientStart = null;
  });
});

ipcMain.handle(
  "provider:update-config",
  async (event, providerId, routingConfig) => {
    if (!session) return { success: false, error: "Not authenticated" };
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
            pythonManager.updateRoutingConfig(routingConfig);
            if (cleanupManager) {
              const mode = routingConfig?.communityMode || "none";
              const legacyPolicy =
                mode === "none" ? "mine" : mode === "all" ? "all" : "users";
              cleanupManager.updatePolicy(legacyPolicy);
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
        process_own_jobs: routingConfig.processOwnJobs ?? false,
        community_mode: routingConfig.communityMode ?? "none",
        allowed_ids: routingConfig.trustedIds ?? [],
        monetize_mode: routingConfig.monetizeMode ?? false,
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
  if (pythonManager) {
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
    mainWindow.setClosable(closable);
  }
});

// Info
ipcMain.handle("get-orchestrator-api-url", () => ORCHESTRATOR_API_URL);
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
ipcMain.handle("get-session", async () => session);

// --- MONETIZE / STRIPE IPC HANDLERS ---

function makeAuthenticatedPostRequest(url) {
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

ipcMain.on("open-external", (event, url) => {
  openExternal(url);
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

ipcMain.handle("auto-compact:get-status", () => {
  if (!autoCompactManager) {
    return { enabled: false, platformSupported: process.platform === "win32" };
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
