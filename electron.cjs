const { app, BrowserWindow, ipcMain, shell, net } = require("electron");
const path = require("path");
const http = require("http");
const os = require("os");

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
const { execFile: _execFile } = require("child_process");

function openExternal(url) {
  // On Linux running inside WSL (Windows host), use explorer.exe to open URLs
  // in the host browser. On native Linux, use the standard shell.openExternal.
  if (process.platform === "linux" && process.env.OPENFORK_WSL_DISTRO) {
    try {
      _execFile("explorer.exe", [url], (err) => {
        if (err) shell.openExternal(url);
      });
      return;
    } catch {
      shell.openExternal(url);
    }
  }
  shell.openExternal(url);
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
  // which already handle .desktop registration through the package manager.
  const appImagePath = process.env.APPIMAGE;
  if (!appImagePath) return;

  const desktopDir = path.join(os.homedir(), ".local", "share", "applications");
  const desktopFile = "openfork-client.desktop";
  const desktopFilePath = path.join(desktopDir, desktopFile);

  const desktopContent = [
    "[Desktop Entry]",
    "Name=Openfork Client",
    "Type=Application",
    "Terminal=false",
    `Exec=${appImagePath} %u`,
    "MimeType=x-scheme-handler/openfork-desktop-app;",
    "Categories=Network;AudioVideo;",
    "Comment=Collaborative movie creation platform",
  ].join("\n") + "\n";

  try {
    const { promises: fsp } = require("fs");
    await fsp.mkdir(desktopDir, { recursive: true });
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
    _execFile("update-desktop-database", [desktopDir], { timeout: 5000 }, () => {});

    console.log("Linux AppImage protocol handler registered.");
  } catch (err) {
    console.error("Failed to register AppImage protocol handler:", err.message);
  }
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

let mainWindow;
let session = null;
let pythonManager;
let scheduleManager;
let cleanupManager;
let isQuittingApp = false; // App-level flag to prevent before-quit race condition
let pendingClientStart = null;

const WINDOWS_DOCKER_API_PORT = 2375;

// Resolved lazily on first use — user-configured or auto-detected
let _resolvedWslDistro = null;

async function listWslDistros() {
  return new Promise((resolve) => {
    execFile(
      "wsl.exe",
      ["--list", "--quiet"],
      { timeout: 5000 },
      (error, stdout) => {
        if (error || !stdout) {
          console.warn("Failed to list WSL distros:", error?.message);
          resolve([]);
          return;
        }

        // `wsl --list --quiet` can return UTF-16 output with embedded null bytes.
        const distros = stdout
          .replace(/\0/g, "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        resolve(distros);
      },
    );
  });
}

function choosePreferredWslDistro(distros) {
  const userDistros = distros.filter(
    (name) => !/^docker-desktop(?:-data)?$/i.test(name),
  );

  const preferred =
    userDistros.find((name) => /^openfork$/i.test(name)) ||
    userDistros.find((name) => /^ubuntu(?:-.+)?$/i.test(name)) ||
    userDistros[0];

  return preferred || "Ubuntu";
}

/**
 * Returns the WSL distro name to use for Docker operations.
 * Priority: (1) user setting in electron-store when it still exists,
 * (2) preferred user distro from `wsl --list`, (3) "Ubuntu".
 */
async function getWslDistroName() {
  if (_resolvedWslDistro) return _resolvedWslDistro;

  const stored = store.get("wslDistro");
  const distros = await listWslDistros();

  if (stored) {
    const stillExists = distros.some(
      (name) => name.toLowerCase() === stored.toLowerCase(),
    );
    if (stillExists) {
      _resolvedWslDistro = stored;
      return _resolvedWslDistro;
    }

    console.warn(
      `Stored WSL distro '${stored}' no longer exists. Falling back to auto-detect.`,
    );
    store.delete("wslDistro");
  }

  _resolvedWslDistro = choosePreferredWslDistro(distros);

  if (distros.length > 0) {
    console.log(`Auto-detected WSL distro: ${_resolvedWslDistro}`);
  } else {
    console.warn("No usable WSL distros found, defaulting to Ubuntu");
  }

  return _resolvedWslDistro;
}

// Listen for auth events to keep the session fresh
supabase.auth.onAuthStateChange((event, newSession) => {
  console.log(`Supabase auth event: ${event}`);
  session = newSession; // Keep main process session variable in sync

  // Notify the renderer process of the session change
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:session", session);

    // If session is lost and we couldn't refresh, force UI update
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
});

// --- AUTHENTICATION ---

async function googleLogin() {
  // Instead of starting an OAuth flow from Electron,
  // we open a page on the website which will handle auth
  // and then redirect back to Electron with the session.
  const syncUrl = `${ORCHESTRATOR_API_URL}/auth/electron-login`;
  console.log(`Opening auth URL: ${syncUrl}`);
  openExternal(syncUrl);
}

async function logout() {
  // First, ensure the python client is stopped before signing out
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

  // --- AUTO UPDATER ---
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
    // USABILITY: Notify renderer of update errors so users can be informed
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:error", {
        message: err.message || "Update failed",
        code: err.code || "UNKNOWN_ERROR",
      });
    }
  });

  // Check for updates once the window is ready
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error("Failed to check for updates:", err);
    });
  });

  mainWindow.webContents.on("did-finish-load", async () => {
    const { data } = await supabase.auth.getSession();
    session = data.session;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("auth:session", session);
    }
  });

  // Instantiate the manager after the window is created
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
  });

  // Instantiate the schedule manager
  scheduleManager = new ScheduleManager({
    pythonManager,
    store,
    mainWindow,
  });
  scheduleManager.loadConfig(); // Load saved schedule on startup

  // Instantiate the Docker cleanup manager (for monetize mode)
  cleanupManager = new DockerCleanupManager({
    store,
    mainWindow,
    execDockerCommand,
  });
  // Auto-resume monitoring if it was enabled in the previous session
  if (cleanupManager.isEnabled()) {
    cleanupManager.startMonitoring();
  }

  // Intercept the close event
  mainWindow.on("close", (event) => {
    if (pythonManager && !pythonManager.isQuitting) {
      event.preventDefault(); // Prevent the window from closing
      app.quit(); // Trigger the before-quit event
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

app.whenReady().then(() => {
  registerAppImageProtocolHandler();
  createWindow();

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
  // If we're already in the quitting process, let it proceed
  if (isQuittingApp) {
    // Don't prevent quit on re-entry - this allows the app to actually quit
    return;
  }

  // Set quitting flags immediately to allow windows to close
  isQuittingApp = true;
  if (pythonManager) {
    pythonManager.isQuitting = true;
  }

  // If there's no python manager or it's not running, let quit proceed
  if (!pythonManager || !pythonManager.isRunning()) {
    return;
  }

  console.log("Electron: before-quit event triggered.");
  event.preventDefault(); // Prevent the app from quitting immediately

  await pythonManager.stop();

  console.log("Electron: Backend stopped. Now quitting.");
  app.quit(); // Now quit the app for real
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleAuthCallback(url);
});

// --- IPC HANDLERS ---
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

    session = data.session; // Keep main process session variable in sync
    return { session: data.session, error: null };
  },
);

ipcMain.on(
  "openfork_client:start",
  async (event, service, routingConfig) => {
    if (!pythonManager || pythonManager.isRunning() || pendingClientStart) {
      return;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("openfork_client:status", "starting");
    }

    pendingClientStart = (async () => {
      if (process.platform === "win32") {
        // Always resolve and expose the WSL distro name so the Python process can
        // use it for WSL-specific operations (e.g. hostname lookup for TCP fallback).
        process.env.OPENFORK_WSL_DISTRO = await getWslDistroName();

        const dockerStatus = await resolveDockerStatus({
          allowNativeStart: false,
        });
        if (!dockerStatus.running) {
          const message =
            dockerStatus.error === "DOCKER_WINDOWS_CONTAINERS"
              ? "Docker Desktop is running Windows containers. Switch it to Linux containers before starting OpenFork."
              : dockerStatus.error === "DOCKER_API_UNREACHABLE"
                ? "Docker is installed in WSL, but its API is not reachable from Windows yet."
                : "Docker is not ready yet. Please retry once the engine is running.";

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

      // Wire up disk cleanup (community mode informs cleanup policy)
      if (cleanupManager) {
        const mode = routingConfig?.communityMode || "none";
        const legacyPolicy = mode === "none" ? "mine" : mode === "all" ? "all" : "users";
        cleanupManager.updatePolicy(legacyPolicy);
      }
    })().finally(() => {
      pendingClientStart = null;
    });
  },
);

ipcMain.handle("provider:update-config", async (event, providerId, routingConfig) => {
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
      response.on("data", (chunk) => { body += chunk.toString(); });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ success: response.statusCode < 400 });
        }
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
});
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

ipcMain.on("window:set-closable", (event, closable) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setClosable(closable);
  }
});

ipcMain.handle("get-orchestrator-api-url", () => ORCHESTRATOR_API_URL);
ipcMain.handle("get-process-info", () => {
  return {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
    v8: process.versions.v8,
    arch: process.arch,
    platform: process.platform,
    argv: process.argv,
    isPackaged: app.isPackaged,
  };
});
ipcMain.handle("get-session", async () => {
  return session;
});

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

// Add persistence handlers for job policy settings
ipcMain.handle("load-settings", async () => {
  try {
    return getAppSettings();
  } catch (error) {
    console.error("Error loading settings:", error);
    return null;
  }
});

ipcMain.handle("save-settings", async (event, settings) => {
  try {
    saveAppSettings(settings);
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

ipcMain.handle("schedule:get-presets", () => {
  return SCHEDULE_PRESETS;
});

ipcMain.handle("schedule:get-idle-time", () => {
  const { powerMonitor } = require("electron");
  return powerMonitor.getSystemIdleTime();
});

ipcMain.handle("search:users", async (event, term) => {
  if (!session) return { success: false, error: "Not authenticated" };
  try {
    const requestUrl = new URL(`${ORCHESTRATOR_API_URL}/api/search/users`);
    requestUrl.searchParams.set("term", term);

    const request = net.request({
      method: "GET",
      url: requestUrl.toString(),
    });

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

    const request = net.request({
      method: "GET",
      url: requestUrl.toString(),
    });

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
    const request = net.request({
      method: "GET",
      url: requestUrl.toString(),
    });

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
            resolve({}); // Return empty object on failure
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

    const request = net.request({
      method: "GET",
      url: requestUrl.toString(),
    });

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
            resolve([]); // Return empty array on failure
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

// --- DOCKER MANAGEMENT ---
const { execSync, exec, execFile } = require("child_process");
const fs = require("fs");

function getAppSettings() {
  const settings = store.get("appSettings");
  return settings && typeof settings === "object" ? settings : {};
}

function saveAppSettings(partialSettings = {}) {
  const nextSettings = {
    ...getAppSettings(),
    ...partialSettings,
  };

  store.set("appSettings", nextSettings);
  return nextSettings;
}

function normalizeDockerEnginePreference(value) {
  return value === "desktop" || value === "wsl" ? value : "auto";
}

function getDockerEnginePreference() {
  return normalizeDockerEnginePreference(
    getAppSettings().dockerEnginePreference,
  );
}

function getDriveLetterFromPath(targetPath) {
  if (typeof targetPath !== "string") return null;
  const match = targetPath.match(/^([a-zA-Z]):/);
  return match ? match[1].toUpperCase() : null;
}

function getFirstExistingPath(candidates = []) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function readJsonFileSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`Failed to read JSON from ${filePath}:`, error.message);
    return null;
  }
}

function collectDockerStorageCandidates(value, keyPath = "", candidates = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectDockerStorageCandidates(item, keyPath, candidates);
    }
    return candidates;
  }

  if (!value || typeof value !== "object") {
    return candidates;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextKeyPath = `${keyPath}.${key}`.toLowerCase();
    if (
      typeof nestedValue === "string" &&
      /^[a-zA-Z]:[\\/]/.test(nestedValue) &&
      /(disk|image|datafolder|storage|vhd)/.test(nextKeyPath)
    ) {
      candidates.push(nestedValue);
      continue;
    }

    if (nestedValue && typeof nestedValue === "object") {
      collectDockerStorageCandidates(nestedValue, nextKeyPath, candidates);
    }
  }

  return candidates;
}

function expandDockerStoragePath(rawPath) {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return null;
  }

  const normalizedPath = path.normalize(rawPath.trim());
  const candidates = [normalizedPath];

  if (!normalizedPath.toLowerCase().endsWith(".vhdx")) {
    candidates.push(
      path.join(normalizedPath, "DockerDesktopWSL", "disk", "docker_data.vhdx"),
      path.join(normalizedPath, "DockerDesktopWSL", "main", "ext4.vhdx"),
      path.join(normalizedPath, "DockerDesktopWSL", "ext4.vhdx"),
      path.join(normalizedPath, "disk", "docker_data.vhdx"),
      path.join(normalizedPath, "main", "ext4.vhdx"),
      path.join(normalizedPath, "ext4.vhdx"),
      path.join(normalizedPath, "docker_data.vhdx"),
    );
  }

  return getFirstExistingPath([...new Set(candidates)]);
}

async function resolveWslStoragePath(distroName) {
  const basePath = await getDistroBasePath(distroName);
  if (!basePath) return null;

  const normalizedBasePath = path.normalize(basePath);
  return (
    getFirstExistingPath([path.join(normalizedBasePath, "ext4.vhdx")]) ||
    normalizedBasePath
  );
}

function resolveDockerDesktopStoragePath() {
  if (process.platform !== "win32") {
    return null;
  }

  const appData = process.env.APPDATA || "";
  const localAppData = process.env.LOCALAPPDATA || "";
  const settingsFiles = [
    path.join(appData, "Docker", "settings-store.json"),
    path.join(appData, "Docker", "settings.json"),
    path.join(localAppData, "Docker", "settings-store.json"),
    path.join(localAppData, "Docker", "settings.json"),
  ];

  const rawCandidates = [];
  for (const settingsFile of settingsFiles) {
    if (!fs.existsSync(settingsFile)) continue;

    const settings = readJsonFileSafe(settingsFile);
    if (!settings) continue;

    rawCandidates.push(
      settings.diskImageLocation,
      settings.diskImageDirectory,
      settings.storageLocation,
      settings.dataFolder,
      ...collectDockerStorageCandidates(settings),
    );
  }

  for (const candidate of rawCandidates) {
    const resolvedPath = expandDockerStoragePath(candidate);
    if (resolvedPath) {
      return resolvedPath;
    }
  }

  return getFirstExistingPath([
    path.join(localAppData, "Docker", "wsl", "disk", "docker_data.vhdx"),
    path.join(localAppData, "Docker", "wsl", "main", "ext4.vhdx"),
    path.join(localAppData, "Docker", "DockerDesktopWSL", "disk", "docker_data.vhdx"),
  ]);
}

/**
 * Returns true when Docker commands are routed through WSL (not native Docker Desktop).
 * OPENFORK_DOCKER_HOST is set only when the WSL Docker TCP endpoint was resolved.
 */
function isUsingWslDocker() {
  return process.platform === "win32" && !!process.env.OPENFORK_DOCKER_HOST;
}

/**
 * After deleting Docker images in WSL mode, physical disk space is not reclaimed
 * automatically — the WSL VHDX must be compacted separately. Emit an event so the
 * UI can surface a "Reclaim space" prompt to the user.
 */
function emitCompactionSuggested() {
  if (!isUsingWslDocker()) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("docker:compaction-suggested");
  }
}

// --- ENGINE INSTALL STATE ---
let currentInstallProcess = null;
let currentInstallCancelled = false;
let currentInstallDistro = null; // distro name being installed — used by cancel handler
const INSTALL_PROGRESS_LOG = "C:\\Windows\\Temp\\openfork_install_progress.log";

// SECURITY: Validate Docker ID format to prevent command injection
// Docker IDs are hex strings (12 or 64 chars for short/full format)
function isValidDockerId(id) {
  if (typeof id !== "string" || !id) return false;
  // Docker IDs are hex strings, allow short (12) or full (64) format
  // Also allow image names like "beschiak/openfork-wan22:latest"
  const dockerIdPattern = /^[a-f0-9]{12,64}$/i;
  const imageNamePattern = /^[a-z0-9][a-z0-9._\/-]*:[a-z0-9._-]+$/i;
  return dockerIdPattern.test(id) || imageNamePattern.test(id);
}

// SECURITY: Escape shell argument to prevent injection
function escapeShellArg(arg) {
  if (!arg) return '""';
  // On Windows, use double quotes and escape internal quotes
  // On Unix, single quotes are safer
  if (process.platform === "win32") {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

async function execDockerCommand(command) {
  const wslDistro =
    process.platform === "win32" ? await getWslDistroName() : null;
  return new Promise((resolve, reject) => {
    // WSL ROBUSTNESS: On Windows, use execFile to avoid CMD shell escaping issues with pipes and quotes
    if (process.platform === "win32" && command.startsWith("docker ")) {
      // When OPENFORK_DOCKER_HOST is not set, Docker Desktop is the active engine.
      // Route directly to the native docker.exe instead of through WSL.
      if (!process.env.OPENFORK_DOCKER_HOST) {
        exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout) => {
          if (error) {
            const msg = error.message.toLowerCase();
            if (
              msg.includes("is not running") ||
              msg.includes("connection refused")
            ) {
              resolve("");
              return;
            }
            console.error(`Docker command error: ${error.message}`);
            reject(error);
            return;
          }
          resolve(stdout.trim());
        });
        return;
      }
      // Use -- separator which is more robust for passing complex strings to WSL
      const args = ["-d", wslDistro, "--", "sudo", "bash", "-c", command];
      execFile(
        "wsl.exe",
        args,
        { maxBuffer: 1024 * 1024 * 10 },
        (error, stdout, stderr) => {
          if (error) {
            // If Docker is not running or distro is missing, we don't want to spam errors in the console
            const msg = error.message.toLowerCase();
            if (
              msg.includes("is not running") ||
              msg.includes("connection refused") ||
              msg.includes(
                "distribution with the supplied name could not be found",
              )
            ) {
              resolve("");
              return;
            }
            console.error(`Docker command error: ${error.message}`);
            reject(error);
            return;
          }
          resolve(stdout.trim());
        },
      );
    } else {
      exec(
        command,
        { maxBuffer: 1024 * 1024 * 10 },
        (error, stdout, stderr) => {
          if (error) {
            if (
              error.message.includes("is not running") ||
              error.message.includes("connection refused")
            ) {
              resolve("");
              return;
            }
            console.error(`Docker command error: ${error.message}`);
            reject(error);
            return;
          }
          resolve(stdout.trim());
        },
      );
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWslIpAddress() {
  if (process.platform !== "win32") {
    return null;
  }

  const wslDistro = await getWslDistroName();
  return new Promise((resolve) => {
    const args = ["-d", wslDistro, "--", "hostname", "-I"];
    execFile("wsl.exe", args, { timeout: 5000 }, (error, stdout) => {
      if (error || !stdout) {
        resolve(null);
        return;
      }

      const ips = stdout.trim().split(/\s+/).filter(Boolean);
      resolve(ips[0] || null);
    });
  });
}

async function getWindowsDockerApiHosts() {
  const hosts = ["127.0.0.1", "localhost"];
  const wslIp = await getWslIpAddress();
  if (wslIp) {
    hosts.push(wslIp);
  }
  return [...new Set(hosts)];
}

function pingDockerApiHost(host, timeoutMs = 1500) {
  if (process.platform !== "win32") {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const request = http.request(
      {
        host,
        port: WINDOWS_DOCKER_API_PORT,
        path: "/_ping",
        method: "GET",
        timeout: timeoutMs,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk.toString();
        });
        response.on("end", () => {
          resolve(response.statusCode === 200 && body.trim() === "OK");
        });
      },
    );

    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });

    request.on("error", () => {
      resolve(false);
    });

    request.end();
  });
}

async function resolveWindowsDockerApiEndpoint(timeoutMs = 20000) {
  if (process.platform !== "win32") {
    return null;
  }

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const hosts = await getWindowsDockerApiHosts();
    for (const host of hosts) {
      if (await pingDockerApiHost(host)) {
        return `tcp://${host}:${WINDOWS_DOCKER_API_PORT}`;
      }
    }

    try {
      await runDockerCheckCommand("docker info > /dev/null 2>&1 || true", {
        useWsl: true,
        wslDistro: await getWslDistroName(),
        timeoutMs: 5000,
      });
    } catch {
      // Best-effort warmup only.
    }

    await sleep(1000);
  }

  const hosts = await getWindowsDockerApiHosts();
  for (const host of hosts) {
    if (await pingDockerApiHost(host)) {
      return `tcp://${host}:${WINDOWS_DOCKER_API_PORT}`;
    }
  }

  return null;
}

let dockerMonitorInterval = null;
let lastContainersJson = "";
let lastImagesJson = "";
let dockerMonitorConsecutiveFailures = 0;
const DOCKER_MONITOR_MAX_FAILURES = 3;

// Cached Docker routing — avoids expensive resolveDockerStatus on every list call
let _cachedRoutingResult = null;
let _cachedRoutingTimestamp = 0;
const ROUTING_CACHE_TTL_MS = 10000; // 10 seconds

/**
 * Ensures that OPENFORK_DOCKER_HOST is correctly set for the active Docker engine.
 * Uses a short-lived cache to avoid calling resolveDockerStatus() on every IPC call.
 * Returns the resolved Docker status.
 */
async function ensureDockerRouting() {
  const now = Date.now();
  if (_cachedRoutingResult && (now - _cachedRoutingTimestamp) < ROUTING_CACHE_TTL_MS) {
    return _cachedRoutingResult;
  }

  const status = await resolveDockerStatus({
    allowNativeStart: false,
    wslHostTimeoutMs: 5000,
  });

  _cachedRoutingResult = status;
  _cachedRoutingTimestamp = now;
  return status;
}

async function checkDockerUpdates() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    const dockerStatus = await resolveDockerStatus({
      allowNativeStart: false,
      wslHostTimeoutMs: 5000,
    });

    // Also update the routing cache so list handlers stay in sync
    _cachedRoutingResult = dockerStatus;
    _cachedRoutingTimestamp = Date.now();

    if (!dockerStatus.running) {
      dockerMonitorConsecutiveFailures++;

      if (
        process.platform === "win32" &&
        dockerStatus.error === "WSL_DISTRO_MISSING"
      ) {
        mainWindow.webContents.send("docker:wsl-distro-missing", {
          distroName: await getWslDistroName(),
        });
      }

      // Only clear the display after consecutive failures to avoid
      // transient WSL Docker API timeouts from flickering the UI.
      if (dockerMonitorConsecutiveFailures >= DOCKER_MONITOR_MAX_FAILURES) {
        if (lastContainersJson !== "") {
          lastContainersJson = "";
          mainWindow.webContents.send("docker:containers-update", []);
        }

        if (lastImagesJson !== "") {
          lastImagesJson = "";
          mainWindow.webContents.send("docker:images-update", []);
        }
      } else {
        console.log(
          `Docker monitor: not running (${dockerMonitorConsecutiveFailures}/${DOCKER_MONITOR_MAX_FAILURES} failures, error: ${dockerStatus.error || "none"}). Keeping current display.`,
        );
      }

      return;
    }

    // Docker is running — reset the failure counter
    dockerMonitorConsecutiveFailures = 0;

    // Check containers
    const containersOutput = await execDockerCommand(
      'docker ps -a --format "{{json .}}" --filter "name=dgn-client"',
    );
    if (containersOutput !== lastContainersJson) {
      lastContainersJson = containersOutput;
      const containers = containersOutput
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            const container = JSON.parse(line);
            return {
              id: container.ID,
              name: container.Names,
              image: container.Image,
              status: container.Status,
              state: container.State,
              created: container.CreatedAt,
            };
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);

      mainWindow.webContents.send("docker:containers-update", containers);
    }

    // Check images
    const imagesOutput = await execDockerCommand(
      'docker images --format "{{json .}}"',
    );
    if (imagesOutput !== lastImagesJson) {
      lastImagesJson = imagesOutput;
      const images = imagesOutput
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            const img = JSON.parse(line);
            return {
              id: img.ID,
              repository: img.Repository,
              tag: img.Tag,
              size: img.Size,
              created: img.CreatedAt || img.CreatedSince,
            };
          } catch (e) {
            return null;
          }
        })
        .filter((img) => {
          if (!img) return false;
          const fullName = `${img.repository}:${img.tag}`.toLowerCase();
          return fullName.includes("openfork");
        });

      mainWindow.webContents.send("docker:images-update", images);
    }
  } catch (error) {
    // Silent fail for background monitor — count as a failure
    dockerMonitorConsecutiveFailures++;
  }
}

function startDockerMonitoring() {
  if (dockerMonitorInterval) return;
  console.log("Starting Docker background monitoring...");
  // Initial check
  checkDockerUpdates();
  // Set interval (5 seconds is a good balance)
  dockerMonitorInterval = setInterval(checkDockerUpdates, 5000);
}

function stopDockerMonitoring() {
  if (dockerMonitorInterval) {
    console.log("Stopping Docker background monitoring...");
    clearInterval(dockerMonitorInterval);
    dockerMonitorInterval = null;
  }
}

ipcMain.on("docker:start-monitoring", startDockerMonitoring);
ipcMain.on("docker:stop-monitoring", stopDockerMonitoring);

ipcMain.handle("docker:list-images", async () => {
  try {
    // Ensure Docker routing (OPENFORK_DOCKER_HOST) is current before querying
    await ensureDockerRouting();

    const output = await execDockerCommand(
      'docker images --format "{{json .}}"',
    );
    if (!output) return { success: true, data: [] };

    const images = output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const img = JSON.parse(line);
        return {
          id: img.ID,
          repository: img.Repository,
          tag: img.Tag,
          size: img.Size,
          created: img.CreatedAt || img.CreatedSince,
        };
      })
      // Double-check each image contains "openfork"
      .filter((img) => {
        const fullName = `${img.repository}:${img.tag}`.toLowerCase();
        return fullName.includes("openfork");
      });
    return { success: true, data: images };
  } catch (error) {
    console.error("Failed to list Docker images:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("docker:list-containers", async () => {
  try {
    // Ensure Docker routing (OPENFORK_DOCKER_HOST) is current before querying
    await ensureDockerRouting();

    const output = await execDockerCommand(
      'docker ps -a --format "{{json .}}" --filter "name=dgn-client"',
    );
    if (!output) return { success: true, data: [] };

    const containers = output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const container = JSON.parse(line);
        return {
          id: container.ID,
          name: container.Names,
          image: container.Image,
          status: container.Status,
          state: container.State,
          created: container.CreatedAt,
        };
      });
    return { success: true, data: containers };
  } catch (error) {
    console.error("Failed to list Docker containers:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("docker:remove-image", async (event, imageId) => {
  try {
    // SECURITY: Validate Docker ID format before use
    if (!isValidDockerId(imageId)) {
      console.warn(`Invalid Docker ID format: ${imageId}`);
      return { success: false, error: "Invalid Docker ID format" };
    }

    // Get all images to verify the ID against our OpenFork filter
    const listOutput = await execDockerCommand(
      'docker images --format "{{.ID}}|{{.Repository}}:{{.Tag}}"',
    );
    const lines = listOutput.split("\n").filter(Boolean);
    const isAllowed = lines.some((line) => {
      const [id, fullName] = line.split("|");
      return (
        (id === imageId || id.startsWith(imageId)) &&
        fullName.toLowerCase().includes("openfork")
      );
    });

    if (!isAllowed) {
      console.warn(`Image ${imageId} validation failed, skipping removal`);
      return { success: false, error: "Only OpenFork images can be removed" };
    }

    // WSL2 ROBUSTNESS: 1. Find and remove ANY containers using this image (running or stopped)
    try {
      const containerIds = await execDockerCommand(
        `docker ps -a -q --filter ancestor=${imageId}`,
      );
      if (containerIds) {
        const ids = containerIds.split("\n").filter(Boolean);
        for (const id of ids) {
          console.log(
            `Force removing dependent container ${id} for image ${imageId}`,
          );
          await execDockerCommand(`docker rm -f ${id}`);
        }
      }
    } catch (e) {
      console.warn(
        `Non-critical error cleaning up containers for image ${imageId}:`,
        e.message,
      );
    }

    // WSL2 ROBUSTNESS: 2. Force remove the image
    await execDockerCommand(`docker rmi -f ${escapeShellArg(imageId)}`);

    // WSL2 ROBUSTNESS: 3. Prune dangling layers to actually recover space
    try {
      await execDockerCommand("docker image prune -f");
    } catch (e) {
      // Ignore prune errors
    }

    // On WSL Docker, rmi + prune free space inside the VHDX but the file itself
    // doesn't shrink until compacted. Suggest that to the user.
    emitCompactionSuggested();

    return { success: true };
  } catch (error) {
    console.error(`Failed to remove Docker image ${imageId}:`, error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("docker:remove-all-images", async () => {
  try {
    // Get all images with openfork in the name
    const listOutput = await execDockerCommand(
      'docker images --format "{{.ID}}|{{.Repository}}:{{.Tag}}"',
    );
    if (!listOutput) return { success: true, removedCount: 0 };

    const lines = listOutput.split("\n").filter(Boolean);
    let removedCount = 0;
    for (const line of lines) {
      const [id, fullName] = line.split("|");
      // Double-check each image contains "openfork"
      if (
        fullName &&
        fullName.toLowerCase().includes("openfork") &&
        isValidDockerId(id)
      ) {
        try {
          await execDockerCommand(`docker rmi -f ${escapeShellArg(id)}`);
          removedCount++;
        } catch (e) {
          console.warn(`Failed to remove image ${id}:`, e.message);
        }
      }
    }

    // Prune dangling layers left behind by rmi (was missing before — real bug)
    try {
      await execDockerCommand("docker image prune -f");
    } catch (e) {
      // Non-fatal
    }

    // On WSL Docker, rmi doesn't shrink the VHDX — suggest compaction to the user
    if (removedCount > 0) emitCompactionSuggested();

    return { success: true, removedCount };
  } catch (error) {
    console.error("Failed to remove all Docker images:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("docker:stop-container", async (event, containerId) => {
  try {
    // SECURITY: Validate Docker ID format before use
    if (!isValidDockerId(containerId)) {
      console.warn(`Invalid Docker container ID format: ${containerId}`);
      return { success: false, error: "Invalid container ID format" };
    }
    await execDockerCommand(`docker stop ${escapeShellArg(containerId)}`);
    await execDockerCommand(`docker rm -f ${escapeShellArg(containerId)}`);
    return { success: true };
  } catch (error) {
    console.error(`Failed to stop container ${containerId}:`, error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("docker:stop-all-containers", async () => {
  try {
    const listOutput = await execDockerCommand(
      'docker ps -a --format "{{.ID}}" --filter "name=dgn-client"',
    );
    if (!listOutput) return { success: true, stoppedCount: 0 };

    const containerIds = listOutput.split("\n").filter(Boolean);
    for (const id of containerIds) {
      // SECURITY: Validate each container ID
      if (!isValidDockerId(id)) continue;
      try {
        await execDockerCommand(`docker stop ${escapeShellArg(id)}`);
        await execDockerCommand(`docker rm -f ${escapeShellArg(id)}`);
      } catch (e) {
        console.warn(`Failed to stop/remove container ${id}:`, e.message);
      }
    }
    return { success: true, stoppedCount: containerIds.length };
  } catch (error) {
    console.error("Failed to stop all containers:", error);
    return { success: false, error: error.message };
  }
});

// Robust Surgical Clean: Stop/Remove OpenFork containers, images, and volumes
ipcMain.handle("docker:clean-openfork", async () => {
  try {
    console.log("Starting targeted OpenFork cleanup...");
    let stoppedCount = 0;
    let removedCount = 0;

    // 1. Force remove all dgn-client containers (by name)
    try {
      const containerOutput = await execDockerCommand(
        'docker ps -a -q --filter "name=dgn-client"',
      );
      if (containerOutput) {
        const ids = containerOutput.split("\n").filter(Boolean);
        for (const id of ids) {
          await execDockerCommand(`docker rm -f ${id}`);
          stoppedCount++;
        }
      }
    } catch (e) {
      console.warn("Error cleaning named containers:", e.message);
    }

    // 2. Find ALL images containing 'openfork' and their dependent containers
    try {
      const imageOutput = await execDockerCommand(
        'docker images --format "{{.ID}}|{{.Repository}}"',
      );
      if (imageOutput) {
        const lines = imageOutput.split("\n").filter(Boolean);
        for (const line of lines) {
          const [id, repo] = line.split("|");
          if (repo.toLowerCase().includes("openfork")) {
            // Find any remaining containers using this image (even if not named dgn-client)
            try {
              const deps = await execDockerCommand(
                `docker ps -a -q --filter ancestor=${id}`,
              );
              if (deps) {
                const depIds = deps.split("\n").filter(Boolean);
                for (const depId of depIds) {
                  await execDockerCommand(`docker rm -f ${depId}`);
                  stoppedCount++;
                }
              }
            } catch (e) {}

            // Remove the image
            try {
              await execDockerCommand(`docker rmi -f ${id}`);
              removedCount++;
            } catch (e) {
              console.warn(`Failed to remove image ${id}:`, e.message);
            }
          }
        }
      }
    } catch (e) {
      console.warn("Error cleaning images:", e.message);
    }

    // 3. Remove all associated volumes (dangling ones usually, or OpenFork specifically if named)
    try {
      await execDockerCommand("docker volume prune -f");
    } catch (e) {}

    // 4. Aggressive Prune to reclaim WSL2 space (removes all unused images, not just dangling)
    // We use -af to be aggressive about reclaiming the 10-20GB VHDX space
    try {
      await execDockerCommand("docker image prune -af");
      await execDockerCommand("docker container prune -f");
    } catch (e) {}

    // Suggest VHDX compaction now that a large purge has freed space inside WSL
    if (removedCount > 0) emitCompactionSuggested();

    return { success: true, stoppedCount, removedCount };
  } catch (error) {
    console.error("Failed to clean OpenFork data:", error);
    return { success: false, error: error.message };
  }
});

// Get disk space information
ipcMain.handle("docker:get-disk-space", async () => {
  try {
    let totalBytes, freeBytes, usedBytes, diskPath;

    if (process.platform === "win32") {
      let driveLetter = getWindowsSystemDriveLetter();
      let storagePath = `${driveLetter}:\\`;

      if (isUsingWslDocker()) {
        // In OpenFork WSL mode, Docker's physical storage lives in the distro VHDX.
        const wslStoragePath = await resolveWslStoragePath(
          await getWslDistroName(),
        );
        if (wslStoragePath) {
          storagePath = wslStoragePath;
          driveLetter = getDriveLetterFromPath(wslStoragePath) || driveLetter;
        }
      } else {
        const nativeStoragePath = resolveDockerDesktopStoragePath();
        if (nativeStoragePath) {
          storagePath = nativeStoragePath;
          driveLetter =
            getDriveLetterFromPath(nativeStoragePath) || driveLetter;
        }
      }

      const psCommand = `Get-PSDrive ${driveLetter} | Select-Object Free, Used | ConvertTo-Json`;

      const output = await new Promise((resolve, reject) => {
        exec(
          `powershell -NoProfile -NonInteractive -Command "${psCommand}"`,
          { timeout: 15000 },
          (error, stdout, stderr) => {
            if (error) {
              console.error(
                "PowerShell disk space check error:",
                error.message,
              );
              // Fallback: Just return something so the UI doesn't spin, but handle it gracefully
              resolve("");
              return;
            }
            resolve(stdout.trim());
          },
        );
      });

      if (output) {
        try {
          const diskInfo = JSON.parse(output);
          freeBytes = diskInfo.Free;
          usedBytes = diskInfo.Used;
          totalBytes = freeBytes + usedBytes;
          diskPath = storagePath;
        } catch (e) {
          console.error("Error parsing disk space info:", e);
        }
      }

      // If we don't have bytes yet (PowerShell failed or timed out), use safe defaults
      if (!totalBytes) {
        return {
          success: false,
          error: "Failed to query system disk space",
          data: { total_gb: "0", used_gb: "0", free_gb: "0", path: "C:\\" },
        };
      }
    } else {
      let targetPath = "/";
      if (process.platform === "linux") {
        try {
          const dockerRootOutput = await execDockerCommand(
            'docker info --format "{{.DockerRootDir}}"',
          );
          if (dockerRootOutput) {
            targetPath = dockerRootOutput.split(/\r?\n/)[0].trim() || "/";
          }
        } catch {
          targetPath = "/";
        }
      }

      const dfOutput = await new Promise((resolve, reject) => {
        exec(
          `df -k ${escapeShellArg(targetPath)}`,
          { timeout: 10000 },
          (error, stdout) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(stdout.trim());
          },
        );
      });

      // Parse df output (skip header, get second line)
      const lines = dfOutput.split("\n");
      if (lines.length < 2) throw new Error("Invalid df output");

      const parts = lines[1].split(/\s+/);
      // df -k gives: Filesystem 1K-blocks Used Available Use% Mounted
      const totalKB = parseInt(parts[1]);
      const usedKB = parseInt(parts[2]);
      const availableKB = parseInt(parts[3]);

      totalBytes = totalKB * 1024;
      usedBytes = usedKB * 1024;
      freeBytes = availableKB * 1024;
      diskPath = targetPath;
    }

    return {
      success: true,
      data: {
        total_gb: (totalBytes / 1024 ** 3).toFixed(1),
        used_gb: (usedBytes / 1024 ** 3).toFixed(1),
        free_gb: (freeBytes / 1024 ** 3).toFixed(1),
        path: diskPath,
      },
    };
  } catch (error) {
    console.error("Failed to get disk space:", error);
    return {
      success: false,
      error: error.message,
      data: { total_gb: "0", used_gb: "0", free_gb: "0", path: "" },
    };
  }
});

// --- DOCKER DISK MANAGEMENT ---

ipcMain.handle("docker:reclaim-space", async () => {
  // Compaction only makes sense when Docker is running inside a WSL VHDX.
  // Native Docker Desktop manages its own VHDX and does not expose a distro entry
  // in the registry — compact-wsl.ps1 would fail to find it.
  if (!isUsingWslDocker()) {
    return {
      success: false,
      error: "NOT_WSL_MODE",
      message:
        "Disk compaction is only available when using WSL Docker. " +
        "Native Docker Desktop manages its own storage automatically.",
    };
  }

  // Refuse to compact while the DGN client is running — compact-wsl.ps1
  // shuts down WSL entirely, which would abruptly kill the Python process.
  if (pythonManager && pythonManager.isRunning()) {
    return {
      success: false,
      error: "CLIENT_RUNNING",
      message: "Stop the DGN engine before compacting disk space.",
    };
  }

  try {
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, "scripts", "compact-wsl.ps1")
      : path.join(__dirname, "scripts", "compact-wsl.ps1");

    const wslDistro = await getWslDistroName();
    return new Promise((resolve) => {
      // Use execFile to avoid CMD shell escaping issues
      const args = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-DistroName",
        wslDistro,
      ];
      execFile("powershell.exe", args, (error) => {
        if (error) {
          console.error("Compaction failed:", error);
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

async function runElevatedPowerShell(scriptPath, args = []) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ success: false, error: "Elevation only supported on Windows" });
      return;
    }

    // Combine all arguments into a single list for the inner powershell
    const innerArgs = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      ...args,
    ];

    // Use PowerShell array literal syntax @('arg1', 'arg2') for -ArgumentList.
    // IMPORTANT: Start-Process -ArgumentList joins array elements with spaces when
    // constructing the child process command line. Any argument that contains spaces
    // (e.g. the script path under "C:\...\Openfork Client\resources\...") must be
    // wrapped in embedded double-quotes so the child powershell.exe sees it as one token.
    const argumentArray = innerArgs
      .map((arg) => {
        const s = arg.toString().replace(/'/g, "''");
        // Embed double-quotes inside the PS single-quoted string for args with spaces
        return s.includes(" ") ? `'"${s}"'` : `'${s}'`;
      })
      .join(", ");

    // Use -PassThru to capture the process object and check ExitCode after -Wait.
    // Without this, a non-zero exit from the elevated PowerShell is silently swallowed.
    const command = `$p = Start-Process powershell -ArgumentList @(${argumentArray}) -Verb RunAs -Wait -PassThru -WindowStyle Hidden; if ($p.ExitCode -ne 0) { exit $p.ExitCode }`;

    console.log(`Requesting elevation for: ${scriptPath}`);

    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      (error) => {
        currentInstallProcess = null;
        if (currentInstallCancelled) {
          currentInstallCancelled = false;
          resolve({ success: false, error: "cancelled" });
        } else if (error) {
          console.error("Elevation failed or was cancelled:", error.message);
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true });
        }
      },
    );
    currentInstallProcess = child;
  });
}

ipcMain.handle("docker:relocate-storage", async (event, newDrivePath) => {
  try {
    const relocateScriptPath = app.isPackaged
      ? path.join(process.resourcesPath, "scripts", "relocate-wsl.ps1")
      : path.join(__dirname, "scripts", "relocate-wsl.ps1");

    const setupScriptPath = app.isPackaged
      ? path.join(process.resourcesPath, "bin", "setup-wsl.ps1")
      : path.join(__dirname, "..", "client", "setup-wsl.ps1");

    // First, wipe the old one (this script does not require elevation for its primary function,
    // but it might if it needs to delete files in protected locations. For now, keep it as is.)
    console.log(
      `Cleaning up old distribution before relocation to: ${newDrivePath}`,
    );
    const relocateArgs = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      relocateScriptPath,
      "-DistroName",
      await getWslDistroName(),
      "-NewLocation",
      newDrivePath,
    ];

    const relocateResult = await new Promise((resolve) => {
      execFile("powershell.exe", relocateArgs, (error) => {
        if (error) {
          console.error("Relocation wipe failed:", error.message);
          resolve({
            success: false,
            error: `Failed to clean up old distribution: ${error.message}`,
          });
        } else {
          console.log("Old distribution cleanup completed.");
          resolve({ success: true });
        }
      });
    });

    if (!relocateResult.success) {
      return relocateResult;
    }

    // Now, trigger a fresh setup WITH elevation
    console.log("Triggering fresh engine installation (elevated)...");
    const setupArgs = newDrivePath ? ["-InstallPath", newDrivePath] : [];
    const result = await runElevatedPowerShell(setupScriptPath, setupArgs);

    if (!result.success) {
      console.error("Relocation install failed:", result.error);
      return { success: false, error: `Installation failed: ${result.error}` };
    } else {
      // Save the new base path in settings
      saveAppSettings({ wslStoragePath: newDrivePath });
      console.log(`Engine reinstalled successfully at ${newDrivePath}.`);
      return { success: true };
    }
  } catch (error) {
    console.error("Error during docker:relocate-storage:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-available-drives", async () => {
  return new Promise((resolve) => {
    // Fixed PowerShell command string for execFile
    const psCommand =
      "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{Name='FreeGB';Expression={[math]::Round($_.Free/1GB, 1)}} | ConvertTo-Json";
    const args = ["-NoProfile", "-NonInteractive", "-Command", psCommand];

    execFile("powershell.exe", args, (error, stdout) => {
      if (error) {
        console.error("Failed to get drives:", error);
        resolve([]);
      } else {
        try {
          const result = JSON.parse(stdout);
          const drives = Array.isArray(result) ? result : [result];
          // Map PascalCase from PowerShell to camelCase for the API
          resolve(
            drives.map((d) => ({
              name: d.Name,
              freeGB: d.FreeGB,
            })),
          );
        } catch (e) {
          console.error("JSON parse error for drives:", e);
          resolve([]);
        }
      }
    });
  });
});

// --- DEPENDENCY DETECTION ---

async function getDistroBasePath(distroName) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve(null);
      return;
    }
    // Query registry for the distribution's BasePath
    const psCommand = `Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\*' | Where-Object DistributionName -eq '${distroName}' | Select-Object -ExpandProperty BasePath`;
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand],
      (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

async function checkDistroExists(distroName) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve(true); // Always true on Linux/macOS
      return;
    }
    // Using powershell to list distros is more robust against encoding issues (UTF-16)
    // and weird exit codes that wsl.exe -l -v sometimes returns.
    const psCommand = "wsl.exe -l -v | Out-String";
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", psCommand],
      (error, stdout) => {
        // Even if there's an error, check the output as it might contain the list anyway
        const output = (stdout || "").replace(/\0/g, "");
        if (output.includes(distroName)) {
          resolve(true);
        } else {
          if (error) {
            console.error(
              `WSL check failed: ${error.message}. Output: ${output}`,
            );
          }
          resolve(false);
        }
      },
    );
  });
}

function getWindowsSystemDriveLetter() {
  const match = (process.env.SYSTEMDRIVE || "C:").match(/([a-zA-Z]):?/);
  return match ? match[1].toUpperCase() : "C";
}

function classifyDockerCheckError(errorMessage = "", stderr = "") {
  const combined = `${errorMessage}\n${stderr}`.toLowerCase();

  if (combined.includes("permission denied")) {
    return "DOCKER_PERMISSION_DENIED";
  }

  return null;
}

async function runDockerCheckCommand(
  cmd,
  { useWsl = false, wslDistro = null, wslUser = "root", timeoutMs } = {},
) {
  return new Promise((resolve) => {
    if (useWsl && process.platform === "win32") {
      const args = [
        "-d",
        wslDistro,
        "--user",
        wslUser,
        "--",
        "bash",
        "-lc",
        cmd,
      ];

      execFile(
        "wsl.exe",
        args,
        { timeout: timeoutMs ?? 15000 },
        (error, stdout, stderr) => {
          if (error) {
            console.log(`Check command '${cmd}' failed: ${error.message}`);
            console.log(`WSL Stdout: ${stdout}`);
            console.log(`WSL Stderr: ${stderr}`);
            resolve({
              success: false,
              error: error.message,
              stderr: stderr?.trim() || "",
            });
            return;
          }

          resolve({ success: true, output: stdout.trim() });
        },
      );
      return;
    }

    exec(
      cmd,
      { timeout: timeoutMs ?? 10000 },
      (error, stdout, stderr) => {
        if (error) {
          console.log(`Check command '${cmd}' failed: ${error.message}`);
          console.log(`Stdout: ${stdout}`);
          console.log(`Stderr: ${stderr}`);
          resolve({
            success: false,
            error: error.message,
            stderr: stderr?.trim() || "",
          });
          return;
        }

        resolve({ success: true, output: stdout.trim() });
      },
    );
  });
}

async function checkNativeDocker() {
  if (process.platform !== "win32") return { installed: false, running: false };

  return new Promise((resolve) => {
    // Check if docker.exe is in PATH or common install location
    const commonPath =
      "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
    const hasDockerExe = fs.existsSync(commonPath);
    const dockerCmd = hasDockerExe ? `"${commonPath}"` : "docker.exe";

    exec("where docker.exe", (error, stdout) => {
      const inPath = !error && stdout.trim().length > 0;
      if (!inPath && !hasDockerExe) {
        resolve({ installed: false, running: false });
        return;
      }

      // Check if Docker Desktop process is running or pipe exists
      exec(
        'tasklist /FI "IMAGENAME eq Docker Desktop.exe" /NH',
        (err, stdout) => {
          const processRunning = !err && stdout.includes("Docker Desktop.exe");

          // Advanced check: verify if the Docker named pipe exists (most reliable indicator)
          const pipePath = "\\\\.\\pipe\\docker_engine";
          const pipeExists = fs.existsSync(pipePath);

          // Check which container mode Docker Desktop is exposing.
          // OpenFork requires Linux containers.
          exec(
            `${dockerCmd} version --format "{{.Server.Os}}"`,
            (versionError, versionStdout) => {
              const serverOs = versionStdout.trim().toLowerCase() || null;
              const storagePath = resolveDockerDesktopStoragePath();

              resolve({
                installed: true,
                running: serverOs === "linux",
                isNative: true,
                isProcessRunning: processRunning || pipeExists,
                installDrive:
                  getDriveLetterFromPath(storagePath) ||
                  getWindowsSystemDriveLetter(),
                storagePath,
                serverOs,
                isWindowsContainers: serverOs === "windows",
                lastError: versionError?.message,
              });
            },
          );
        },
      );
    });
  });
}

async function checkWslDockerStatus({ hostTimeoutMs = 15000 } = {}) {
  if (process.platform !== "win32") {
    return { installed: false, running: false };
  }

  const wslDistro = await getWslDistroName();
  process.env.OPENFORK_WSL_DISTRO = wslDistro;

  const distroExists = await checkDistroExists(wslDistro);
  if (!distroExists) {
    console.log(`WSL distro '${wslDistro}' is missing`);
    return {
      installed: false,
      running: false,
      isNative: false,
      error: "WSL_DISTRO_MISSING",
      wslDistro,
    };
  }

  const storagePath = await resolveWslStoragePath(wslDistro);
  const installDrive = getDriveLetterFromPath(storagePath);

  const versionResult = await runDockerCheckCommand("docker --version", {
    useWsl: true,
    wslDistro,
  });
  if (!versionResult.success) {
    console.log(`Docker CLI not found inside WSL distro '${wslDistro}'`);
    return {
      installed: false,
      running: false,
      isNative: false,
      installDrive,
      storagePath,
      error:
        classifyDockerCheckError(versionResult.error, versionResult.stderr) ||
        undefined,
      wslDistro,
    };
  }

  const infoResult = await runDockerCheckCommand("docker info", {
    useWsl: true,
    wslDistro,
  });
  if (!infoResult.success) {
    console.log(
      `Docker is installed in WSL distro '${wslDistro}' but not ready:`,
      infoResult.error,
    );
    return {
      installed: true,
      running: false,
      isNative: false,
      installDrive,
      storagePath,
      error:
        classifyDockerCheckError(infoResult.error, infoResult.stderr) ||
        undefined,
      wslDistro,
    };
  }

  const dockerHost = await resolveWindowsDockerApiEndpoint(hostTimeoutMs);
  if (!dockerHost) {
    return {
      installed: true,
      running: false,
      isNative: false,
      installDrive,
      storagePath,
      error: "DOCKER_API_UNREACHABLE",
      wslDistro,
    };
  }

  return {
    installed: true,
    running: true,
    isNative: false,
    installDrive,
    storagePath,
    dockerHost,
    wslDistro,
  };
}

function withWindowsDockerMetadata(status, { preference, native, wsl }) {
  return {
    ...status,
    enginePreference: preference,
    availableEngines: {
      desktop: !!native.installed,
      wsl: !!wsl.installed,
    },
  };
}

function buildRunningNativeStatus(native) {
  delete process.env.OPENFORK_DOCKER_HOST;
  return {
    installed: true,
    running: true,
    isNative: true,
    installDrive: native.installDrive,
    storagePath: native.storagePath,
    activeEngine: "desktop",
  };
}

function buildRunningWslStatus(wsl) {
  process.env.OPENFORK_DOCKER_HOST = wsl.dockerHost;
  return {
    installed: true,
    running: true,
    isNative: false,
    installDrive: wsl.installDrive,
    storagePath: wsl.storagePath,
    activeEngine: "wsl",
  };
}

async function buildNativeStatus(native, { allowNativeStart } = {}) {
  delete process.env.OPENFORK_DOCKER_HOST;

  if (native.isWindowsContainers) {
    return {
      installed: true,
      running: false,
      isNative: true,
      installDrive: native.installDrive,
      storagePath: native.storagePath,
      error: "DOCKER_WINDOWS_CONTAINERS",
    };
  }

  if (!native.isProcessRunning && allowNativeStart) {
    console.log("Docker Desktop is not running. Attempting auto-start...");
    const startResult = await startNativeDocker();
    return {
      installed: true,
      running: false,
      isNative: true,
      installDrive: native.installDrive,
      storagePath: native.storagePath,
      isStarting: startResult.success,
    };
  }

  return {
    installed: true,
    running: false,
    isNative: true,
    installDrive: native.installDrive,
    storagePath: native.storagePath,
    isStarting: !!native.isProcessRunning,
  };
}

function buildWslStatus(wsl) {
  delete process.env.OPENFORK_DOCKER_HOST;
  return {
    installed: true,
    running: false,
    isNative: false,
    installDrive: wsl.installDrive,
    storagePath: wsl.storagePath,
    error: wsl.error,
  };
}

async function resolveDockerStatus(
  { allowNativeStart = true, wslHostTimeoutMs = 15000 } = {},
) {
  if (process.platform !== "win32") {
    const versionResult = await runDockerCheckCommand("docker --version");
    if (!versionResult.success) {
      return { installed: false, running: false };
    }

    const infoResult = await runDockerCheckCommand("docker info");
    if (infoResult.success) {
      return { installed: true, running: true, activeEngine: "linux" };
    }

    return {
      installed: true,
      running: false,
      activeEngine: "linux",
      error:
        classifyDockerCheckError(infoResult.error, infoResult.stderr) ||
        undefined,
    };
  }

  const preference = getDockerEnginePreference();
  const [native, wsl] = await Promise.all([
    checkNativeDocker(),
    checkWslDockerStatus({ hostTimeoutMs: wslHostTimeoutMs }),
  ]);

  const decorate = (status) =>
    withWindowsDockerMetadata(status, { preference, native, wsl });

  if (preference === "desktop" && native.installed) {
    return decorate(
      native.running
        ? buildRunningNativeStatus(native)
        : await buildNativeStatus(native, { allowNativeStart }),
    );
  }

  if (preference === "wsl" && wsl.installed) {
    return decorate(wsl.running ? buildRunningWslStatus(wsl) : buildWslStatus(wsl));
  }

  if (preference === "desktop" && !native.installed && wsl.installed) {
    return decorate(wsl.running ? buildRunningWslStatus(wsl) : buildWslStatus(wsl));
  }

  if (preference === "wsl" && !wsl.installed && native.installed) {
    return decorate(
      native.running
        ? buildRunningNativeStatus(native)
        : await buildNativeStatus(native, { allowNativeStart }),
    );
  }

  if (native.running) {
    return decorate(buildRunningNativeStatus(native));
  }

  if (wsl.running) {
    return decorate(buildRunningWslStatus(wsl));
  }

  if (wsl.installed && native.isWindowsContainers) {
    return decorate(buildWslStatus(wsl));
  }

  if (native.installed) {
    return decorate(await buildNativeStatus(native, { allowNativeStart }));
  }

  if (wsl.installed) {
    return decorate(buildWslStatus(wsl));
  }

  delete process.env.OPENFORK_DOCKER_HOST;

  return decorate({
    installed: false,
    running: false,
    error: wsl.error,
  });
}

async function startNativeDocker() {
  if (process.platform !== "win32") return { success: false };

  return new Promise((resolve) => {
    console.log("Attempting to start Docker Desktop...");
    // Attempt to start Docker Desktop using the default GUI executable
    const dockerDesktopPath =
      "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";
    if (!fs.existsSync(dockerDesktopPath)) {
      console.error("Docker Desktop GUI executable not found at default path.");
      resolve({ success: false, error: "DOCKER_DESKTOP_NOT_FOUND" });
      return;
    }

    const command = `Start-Process "${dockerDesktopPath}"`;
    execFile("powershell.exe", ["-NoProfile", "-Command", command], (error) => {
      if (error) {
        console.error("Failed to launch Docker Desktop:", error.message);
        resolve({ success: false, error: error.message });
      } else {
        console.log("Docker Desktop launch command sent.");
        resolve({ success: true });
      }
    });
  });
}

ipcMain.handle("deps:check-docker", async () => {
  try {
    return await resolveDockerStatus({ allowNativeStart: true });
  } catch (err) {
    console.error("Unexpected error checking Docker:", err);
    return { installed: false, running: false };
  }
});

// Phase mapping: parse a log line and return { phase, percent } if it matches a known step
function parseInstallPhase(line) {
  // Dynamic download progress: "Downloading Ubuntu rootfs... 45% (58.6 MB / 130.2 MB)"
  const dlMatch = line.match(/Downloading Ubuntu rootfs\.\.\. (\d+)%/);
  if (dlMatch) {
    const dlPct = parseInt(dlMatch[1], 10);
    // Map 0-100% download into the 18-27% range (Installing Ubuntu starts at 28%)
    const percent = 18 + Math.floor((dlPct / 100) * 9);
    return { phase: "Downloading Ubuntu (~130MB)", percent };
  }

  const phases = [
    {
      re: /Checking Windows Subsystem|Checking system/i,
      phase: "Checking system requirements",
      percent: 5,
    },
    {
      re: /Enabling WSL feature|Enabling Virtual Machine/i,
      phase: "Enabling WSL features",
      percent: 10,
    },
    {
      re: /Downloading Ubuntu/i,
      phase: "Downloading Ubuntu (~130MB)",
      percent: 18,
    },
    {
      re: /Download complete/i,
      phase: "Download complete",
      percent: 27,
    },
    {
      re: /Importing |Installing Ubuntu without launch/i,
      phase: "Installing Ubuntu",
      percent: 28,
    },
    {
      re: /Waiting for WSL to list/i,
      phase: "Registering Ubuntu",
      percent: 40,
    },
    {
      re: /Provisioning default user/i,
      phase: "Configuring Ubuntu user",
      percent: 50,
    },
    { re: /Restarting WSL/i, phase: "Restarting WSL", percent: 55 },
    {
      re: /Enabling Sparse VHD/i,
      phase: "Optimizing disk storage",
      percent: 60,
    },
    {
      re: /Ensuring WSL is running/i,
      phase: "Running setup inside WSL…",
      percent: 63,
    },
    {
      re: /\[Linux\].*Installing Docker/i,
      phase: "Installing Docker Engine",
      percent: 70,
    },
    {
      re: /\[Linux\].*Docker is already/i,
      phase: "Docker already present",
      percent: 65,
    },
    {
      re: /\[Linux\].*Installing NVIDIA/i,
      phase: "Installing NVIDIA Container Toolkit",
      percent: 80,
    },
    {
      re: /\[Linux\].*NVIDIA Container Toolkit is already/i,
      phase: "NVIDIA toolkit present",
      percent: 80,
    },
    {
      re: /\[Linux\].*Configuring Docker/i,
      phase: "Configuring Docker TCP",
      percent: 88,
    },
    {
      re: /\[Linux\].*Waiting for Docker daemon/i,
      phase: "Starting Docker daemon",
      percent: 93,
    },
    {
      re: /\[Linux\].*Docker daemon is running/i,
      phase: "Docker daemon running",
      percent: 97,
    },
    {
      re: /Setup Complete|OpenFork AI Engine Setup Complete/i,
      phase: "Setup complete!",
      percent: 100,
    },
  ];
  for (const { re, phase, percent } of phases) {
    if (re.test(line)) return { phase, percent };
  }
  return null;
}

ipcMain.handle("deps:install-engine", async (event, installPath) => {
  console.log(
    `Starting engine installation on path: ${installPath || "default"}`,
  );

  if (process.platform === "darwin") {
    return { success: false, error: "Auto-install not supported on macOS." };
  }

  const scriptPath =
    process.platform === "win32"
      ? app.isPackaged
        ? path.join(process.resourcesPath, "bin", "setup-wsl.ps1")
        : path.join(__dirname, "..", "client", "setup-wsl.ps1")
      : app.isPackaged
        ? path.join(process.resourcesPath, "bin", "setup-linux.sh")
        : path.join(__dirname, "..", "client", "setup-linux.sh");

  if (process.platform === "win32") {
    console.log(`Using setup script: ${scriptPath}`);

    // Clear the progress log before starting
    try {
      fs.writeFileSync(INSTALL_PROGRESS_LOG, "", "utf8");
    } catch (_) {}

    let lastReadPos = 0;
    let lastPhase = "";
    let lastPercent = 0;

    // Poll the log file every 500ms and forward new lines to the renderer
    const watchInterval = setInterval(() => {
      try {
        const stat = fs.statSync(INSTALL_PROGRESS_LOG);
        if (stat.size <= lastReadPos) return;
        const buf = Buffer.alloc(stat.size - lastReadPos);
        const fd = fs.openSync(INSTALL_PROGRESS_LOG, "r");
        fs.readSync(fd, buf, 0, buf.length, lastReadPos);
        fs.closeSync(fd);
        lastReadPos = stat.size;
        const newText = buf.toString("utf8");
        const lines = newText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        for (const line of lines) {
          const phaseInfo = parseInstallPhase(line);
          if (phaseInfo) {
            lastPhase = phaseInfo.phase;
            lastPercent = phaseInfo.percent;
          }
          mainWindow?.webContents.send("deps:install-progress", {
            line,
            phase: lastPhase,
            percent: lastPercent,
          });
        }
      } catch (_) {
        /* log not yet created or read error — ignore */
      }
    }, 500);

    const distroName = installPath ? "OpenFork" : "Ubuntu";
    currentInstallDistro = distroName;
    const setupArgs = installPath
      ? ["-InstallPath", installPath, "-DistroName", "OpenFork"]
      : [];
    let result;
    try {
      result = await runElevatedPowerShell(scriptPath, setupArgs);
    } finally {
      currentInstallDistro = null;
      clearInterval(watchInterval);
      try {
        fs.unlinkSync(INSTALL_PROGRESS_LOG);
      } catch (_) {}
    }

    if (!result.success) {
      console.error("Installation process error:", result.error);
      return { success: false, error: result.error };
    }

    // Persist the distro name so all subsequent checks (Docker, monitoring) use it
    store.set("wslDistro", distroName);
    _resolvedWslDistro = distroName;

    console.log("Installation process completed successfully.");
    return { success: true };
  } else {
    // Linux pkexec handler (no progress streaming on Linux)
    return new Promise((resolve) => {
      console.log(`Using setup script: ${scriptPath}`);
      const command = `pkexec bash "${scriptPath}"`;
      exec(command, (error) => {
        if (error) {
          console.error("Installation process error:", error.message);
          resolve({ success: false, error: error.message });
        } else {
          console.log("Installation process completed successfully.");
          resolve({ success: true });
        }
      });
    });
  }
});

ipcMain.handle("deps:cancel-install", async () => {
  if (!currentInstallProcess) return { success: true };
  currentInstallCancelled = true;
  const pid = currentInstallProcess.pid;
  // Kill the outer powershell process
  currentInstallProcess.kill();
  // Also try to kill the full process tree (includes elevated child)
  try {
    execSync(`taskkill /F /T /PID ${pid}`);
  } catch (_) {}
  // Attempt to unregister the partially installed distro
  const distroToClean = currentInstallDistro || "Ubuntu";
  try {
    execSync(`wsl --unregister ${distroToClean}`, { timeout: 15000 });
  } catch (_) {}
  return { success: true };
});

// Clears the cached WSL distro name so the next check re-detects it.
// Useful when switching from the OpenFork distro to Docker Desktop (or vice-versa).
ipcMain.handle("deps:reset-wsl-distro", () => {
  store.delete("wslDistro");
  _resolvedWslDistro = null;
  return { success: true };
});

ipcMain.handle("deps:check-nvidia", async () => {
  try {
    // Minimum CUDA version required for OpenFork AI models
    const MIN_CUDA_VERSION = "12.8";

    // Query GPU name and CUDA version using nvidia-smi.
    // On Windows, Electron may not inherit the full user PATH so we try
    // known installation paths before falling back to PowerShell.
    const nvidiaSmiArgs = [
      "--query-gpu=name,cuda_version",
      "--format=csv,noheader",
    ];

    const runExecFile = (cmd, args, opts) =>
      new Promise((resolve, reject) =>
        execFile(cmd, args, opts, (err, out) =>
          err ? reject(err) : resolve(out),
        ),
      );

    let output;
    if (process.platform === "win32") {
      // C:\Windows\System32\nvidia-smi.exe is a stub that exists but fails
      // when run programmatically. Try real installation paths first, then
      // fall back to PowerShell (which resolves PATH correctly).

      // Try direct paths first without existence check (fs.existsSync may fail for various reasons)
      const directPaths = [
        process.env["ProgramFiles"] +
          "\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
        "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
      ];

      let found = false;
      for (const candidate of directPaths) {
        try {
          output = await runExecFile(candidate, nvidiaSmiArgs, {
            timeout: 10000,
          });
          found = true;
          break;
        } catch {
          // try next
        }
      }

      if (!found) {
        // PowerShell treats commas as array separators in argument mode, so
        // --query-gpu=name,cuda_version gets split into two args. Single-quote
        // each argument to make commas literal.
        // Try multiple approaches to find nvidia-smi in PowerShell

        // First, try direct path with PowerShell call operator
        const possiblePaths = [
          "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
          "C:\\Windows\\System32\\nvidia-smi.exe",
        ];

        for (const nvidiaSmiPath of possiblePaths) {
          try {
            output = await runExecFile(
              "powershell.exe",
              [
                "-NoProfile",
                "-Command",
                `& "${nvidiaSmiPath}" '--query-gpu=name,cuda_version' '--format=csv,noheader'`,
              ],
              { timeout: 15000 },
            );
            found = true;
            break;
          } catch {
            // try next path
          }
        }

        // If direct paths didn't work, try using cmd.exe where command
        if (!found) {
          try {
            output = await runExecFile("cmd.exe", ["/c", "where nvidia-smi"], {
              timeout: 15000,
            });
            const nvidiaPath = output.toString().trim().split("\r?\n")[0];
            if (nvidiaPath) {
              output = await runExecFile(nvidiaPath, nvidiaSmiArgs, {
                timeout: 15000,
              });
              found = true;
            }
          } catch {
            // try next approach
          }
        }

        // Next try PowerShell's Get-Command
        if (!found) {
          try {
            output = await runExecFile(
              "powershell.exe",
              [
                "-NoProfile",
                "-Command",
                `(Get-Command nvidia-smi -ErrorAction SilentlyContinue).Source`,
              ],
              { timeout: 15000 },
            );
            const nvidiaPath = output.toString().trim();
            if (nvidiaPath) {
              output = await runExecFile(
                "powershell.exe",
                [
                  "-NoProfile",
                  "-Command",
                  `& "${nvidiaPath}" '--query-gpu=name,cuda_version' '--format=csv,noheader'`,
                ],
                { timeout: 15000 },
              );
              found = true;
            }
          } catch {
            // try next approach
          }
        }

        // Last resort: try with PATH modification via cmd.exe
        if (!found) {
          try {
            output = await runExecFile(
              "cmd.exe",
              [
                "/c",
                `set "PATH=C:\\Program Files\\NVIDIA Corporation\\NVSMI;%PATH%" && nvidia-smi --query-gpu=name,cuda_version --format=csv,noheader`,
              ],
              { timeout: 15000 },
            );
            // If we got here, the command succeeded
            found = true;
          } catch {
            // All methods exhausted - will fall through to outer catch block
          }
        }
      }
    } else {
      output = await runExecFile("nvidia-smi", nvidiaSmiArgs, {
        timeout: 10000,
      });
    }

    const lines = output.toString().trim().split("\n");
    if (lines.length === 0 || !lines[0].trim()) {
      return {
        available: false,
        gpu: null,
        cudaVersion: null,
        isOutdated: false,
      };
    }

    // Parse the first GPU's info (format: "GPU Name, CUDA Version")
    const gpuInfo = lines[0].split(",").map((s) => s.trim());
    const gpuName = gpuInfo[0] || null;
    const cudaVersion = gpuInfo[1] || null;

    // Check if CUDA version is outdated
    let isOutdated = false;
    if (cudaVersion) {
      const [major, minor] = cudaVersion.split(".").map(Number);
      const [minMajor, minMinor] = MIN_CUDA_VERSION.split(".").map(Number);

      // Version comparison: major version must be >= minimum, or same major with >= minor
      if (major < minMajor || (major === minMajor && minor < minMinor)) {
        isOutdated = true;
      }
    }

    return {
      available: true,
      gpu: gpuName,
      cudaVersion: cudaVersion,
      isOutdated: isOutdated,
    };
  } catch (err) {
    console.error("[deps:check-nvidia] detection failed:", err?.message ?? err);
    return {
      available: false,
      gpu: null,
      cudaVersion: null,
      isOutdated: false,
    };
  }
});

ipcMain.handle("deps:open-docker-download", () => {
  const urls = {
    win32: "https://www.docker.com/products/docker-desktop/",
    darwin: "https://www.docker.com/products/docker-desktop/",
    linux: "https://docs.docker.com/engine/install/",
  };
  const url = urls[process.platform] || urls.linux;
  openExternal(url);
  return { success: true };
});

// --- UPDATE HANDLERS ---
ipcMain.handle("update:download", () => {
  autoUpdater.downloadUpdate();
});

ipcMain.handle("update:install", () => {
  autoUpdater.quitAndInstall();
});
