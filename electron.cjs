const { app, BrowserWindow, ipcMain, shell, net } = require("electron");
const path = require("path");
const http = require("http");

if (app.isPackaged) {
}
const Store = require("electron-store").default;
const { createClient } = require("@supabase/supabase-js");
const { PythonProcessManager } = require("./src/python-process-manager.cjs");
const { ScheduleManager, SCHEDULE_PRESETS } = require("./src/schedule-manager.cjs");
const { DockerCleanupManager } = require("./src/docker-cleanup-manager.cjs");
const { autoUpdater } = require("electron-updater");
const process = require("process");


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

const OPENFORK_WSL_DISTRO = "Ubuntu";
const WINDOWS_DOCKER_API_PORT = 2375;

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
        "Authentication state changed to unauthenticated, forcing UI refresh"
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
  shell.openExternal(syncUrl);
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
    icon: path.join(__dirname, app.isPackaged ? "dist/icon.png" : "public/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
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
        code: err.code || "UNKNOWN_ERROR"
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
      } else if (type === "JOB_COMPLETE" || type === "JOB_FAILED") {
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
  }
);

ipcMain.on("openfork_client:start", async (event, service, policy, allowedIds) => {
  if (!pythonManager || pythonManager.isRunning() || pendingClientStart) {
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("openfork_client:status", "starting");
  }

  pendingClientStart = (async () => {
    if (process.platform === "win32") {
      const dockerHost = await resolveWindowsDockerApiEndpoint();
      if (!dockerHost) {
        const message =
          "Docker is installed in WSL, but its API is not reachable from Windows yet.";

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

      process.env.OPENFORK_DOCKER_HOST = dockerHost;
    }

    await pythonManager.start(service, policy, allowedIds);
  })().finally(() => {
    pendingClientStart = null;
  });
});
ipcMain.on("openfork_client:stop", () => {
  if (pythonManager) pythonManager.stop();
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
      response.on("data", (chunk) => { body += chunk.toString(); });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { resolve({ error: "Failed to parse response" }); }
      });
    });
    request.on("error", (err) => resolve({ error: err.message }));
    request.end();
  });
}

ipcMain.on("monetize:start-cleanup", () => {
  if (cleanupManager) cleanupManager.startMonitoring();
});

ipcMain.on("monetize:stop-cleanup", () => {
  if (cleanupManager) cleanupManager.stopMonitoring();
});

ipcMain.handle("monetize:set-idle-timeout", (event, minutes) => {
  if (cleanupManager) cleanupManager.setIdleTimeoutMinutes(minutes);
  return { success: true };
});

ipcMain.handle("monetize:get-config", () => {
  return store.get("monetizeConfig") || { idleTimeoutMinutes: 30 };
});

ipcMain.handle("monetize:open-stripe-onboard", async () => {
  try {
    const data = await makeAuthenticatedPostRequest(`${ORCHESTRATOR_API_URL}/api/stripe/connect/onboard`);
    if (data.url) {
      shell.openExternal(data.url);
      return { success: true };
    }
    return { error: data.error || "No URL returned" };
  } catch (err) {
    console.error("Error opening Stripe onboard:", err);
    return { error: err.message };
  }
});

ipcMain.handle("monetize:open-stripe-dashboard", async () => {
  try {
    const data = await makeAuthenticatedPostRequest(`${ORCHESTRATOR_API_URL}/api/stripe/connect/dashboard`);
    if (data.url) {
      shell.openExternal(data.url);
      return { success: true };
    }
    return { error: data.error || "No URL returned" };
  } catch (err) {
    console.error("Error opening Stripe dashboard:", err);
    return { error: err.message };
  }
});

// Add persistence handlers for job policy settings
ipcMain.handle("load-settings", async () => {
  try {
    const settings = store.get("appSettings") || {};
    return settings;
  } catch (error) {
    console.error("Error loading settings:", error);
    return null;
  }
});

ipcMain.handle("save-settings", async (event, settings) => {
  try {
    store.set("appSettings", settings);
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
  return { mode: "manual", isActive: false, message: "Schedule manager not initialized" };
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
              `Search users failed with status ${response.statusCode}: ${body}`
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
              `Search projects failed with status ${response.statusCode}: ${body}`
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
              `Fetch config failed with status ${response.statusCode}: ${body}`
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
              `Search general failed with status ${response.statusCode}: ${body}`
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

function execDockerCommand(command) {
  return new Promise((resolve, reject) => {
    // WSL ROBUSTNESS: On Windows, use execFile to avoid CMD shell escaping issues with pipes and quotes
    if (process.platform === "win32" && command.startsWith("docker ")) {
      // Use -- separator which is more robust for passing complex strings to WSL
      const args = ["-d", OPENFORK_WSL_DISTRO, "--", "sudo", "bash", "-c", command];
      execFile("wsl.exe", args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
          // If Docker is not running or distro is missing, we don't want to spam errors in the console
          const msg = error.message.toLowerCase();
          if (
            msg.includes("is not running") || 
            msg.includes("connection refused") || 
            msg.includes("distribution with the supplied name could not be found")
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
    } else {
      exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
          if (error.message.includes("is not running") || error.message.includes("connection refused")) {
             resolve("");
             return;
          }
          console.error(`Docker command error: ${error.message}`);
          reject(error);
          return;
        }
        resolve(stdout.trim());
      });
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getWslIpAddress() {
  if (process.platform !== "win32") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const args = ["-d", OPENFORK_WSL_DISTRO, "--", "hostname", "-I"];
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
      }
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
      await execDockerCommand("docker info > /dev/null 2>&1 || true");
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

async function checkDockerUpdates() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    // If on Windows, check if distro exists before monitoring
    if (process.platform === "win32") {
       const exists = await checkDistroExists(OPENFORK_WSL_DISTRO);
       if (!exists) return;
    }

    // Check containers
    const containersOutput = await execDockerCommand(
      'docker ps -a --format "{{json .}}" --filter "name=dgn-client"'
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
      'docker images --format "{{json .}}"'
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
    // Silent fail for background monitor
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
    const output = await execDockerCommand(
      'docker images --format "{{json .}}"'
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
    const output = await execDockerCommand(
      'docker ps -a --format "{{json .}}" --filter "name=dgn-client"'
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
      'docker images --format "{{.ID}}|{{.Repository}}:{{.Tag}}"'
    );
    const lines = listOutput.split("\n").filter(Boolean);
    const isAllowed = lines.some(line => {
      const [id, fullName] = line.split("|");
      return (id === imageId || id.startsWith(imageId)) && fullName.toLowerCase().includes("openfork");
    });

    if (!isAllowed) {
      console.warn(`Image ${imageId} validation failed, skipping removal`);
      return { success: false, error: "Only OpenFork images can be removed" };
    }

    // WSL2 ROBUSTNESS: 1. Find and remove ANY containers using this image (running or stopped)
    try {
      const containerIds = await execDockerCommand(`docker ps -a -q --filter ancestor=${imageId}`);
      if (containerIds) {
        const ids = containerIds.split("\n").filter(Boolean);
        for (const id of ids) {
          console.log(`Force removing dependent container ${id} for image ${imageId}`);
          await execDockerCommand(`docker rm -f ${id}`);
        }
      }
    } catch (e) {
      console.warn(`Non-critical error cleaning up containers for image ${imageId}:`, e.message);
    }

    // WSL2 ROBUSTNESS: 2. Force remove the image
    await execDockerCommand(`docker rmi -f ${escapeShellArg(imageId)}`);
    
    // WSL2 ROBUSTNESS: 3. Prune dangling layers to actually recover space
    try {
      await execDockerCommand("docker image prune -f");
    } catch (e) {
      // Ignore prune errors
    }

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
      'docker images --format "{{.ID}}|{{.Repository}}:{{.Tag}}"'
    );
    if (!listOutput) return { success: true, removedCount: 0 };
    
    const lines = listOutput.split("\n").filter(Boolean);
    let removedCount = 0;
    for (const line of lines) {
      const [id, fullName] = line.split("|");
      // Double-check each image contains "openfork"
      if (fullName && fullName.toLowerCase().includes("openfork") && isValidDockerId(id)) {
        try {
          await execDockerCommand(`docker rmi -f ${escapeShellArg(id)}`);
          removedCount++;
        } catch (e) {
          console.warn(`Failed to remove image ${id}:`, e.message);
        }
      }
    }
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
      'docker ps -a --format "{{.ID}}" --filter "name=dgn-client"'
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
      const containerOutput = await execDockerCommand('docker ps -a -q --filter "name=dgn-client"');
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
      const imageOutput = await execDockerCommand('docker images --format "{{.ID}}|{{.Repository}}"');
      if (imageOutput) {
        const lines = imageOutput.split("\n").filter(Boolean);
        for (const line of lines) {
          const [id, repo] = line.split("|");
          if (repo.toLowerCase().includes("openfork")) {
            // Find any remaining containers using this image (even if not named dgn-client)
            try {
              const deps = await execDockerCommand(`docker ps -a -q --filter ancestor=${id}`);
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
      // Detect where the OpenFork distro is actually installed
      const basePath = await getDistroBasePath(OPENFORK_WSL_DISTRO);
      // Extract drive letter robustly (handles D:, \??\D:, or defaults to C)
      let driveLetter = "C";
      if (basePath) {
        const match = basePath.match(/([a-zA-Z]):/);
        if (match) driveLetter = match[1].toUpperCase();
      }
      
      // Windows: Use PowerShell to get disk info for the detected drive
      const psCommand = `Get-PSDrive ${driveLetter} | Select-Object Free, Used | ConvertTo-Json`;
      
      const output = await new Promise((resolve, reject) => {
        exec(`powershell -NoProfile -NonInteractive -Command "${psCommand}"`, { timeout: 15000 }, (error, stdout, stderr) => {
          if (error) {
            console.error("PowerShell disk space check error:", error.message);
            // Fallback: Just return something so the UI doesn't spin, but handle it gracefully
            resolve("");
            return;
          }
          resolve(stdout.trim());
        });
      });
      
      if (output) {
        try {
          const diskInfo = JSON.parse(output);
          freeBytes = diskInfo.Free;
          usedBytes = diskInfo.Used;
          totalBytes = freeBytes + usedBytes;
          diskPath = `${driveLetter}:\\`;
        } catch (e) {
          console.error("Error parsing disk space info:", e);
        }
      }
      
      // If we don't have bytes yet (PowerShell failed or timed out), use safe defaults
      if (!totalBytes) {
        return {
          success: false,
          error: "Failed to query system disk space",
          data: { total_gb: "0", used_gb: "0", free_gb: "0", path: "C:\\" }
        };
      }
    } else {
      // Linux/macOS: Use df command
      const dfOutput = await new Promise((resolve, reject) => {
        exec("df -k /", { timeout: 10000 }, (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout.trim());
        });
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
      diskPath = "/";
    }
    
    return {
      success: true,
      data: {
        total_gb: (totalBytes / (1024 ** 3)).toFixed(1),
        used_gb: (usedBytes / (1024 ** 3)).toFixed(1),
        free_gb: (freeBytes / (1024 ** 3)).toFixed(1),
        path: diskPath
      }
    };
  } catch (error) {
    console.error("Failed to get disk space:", error);
    return {
      success: false,
      error: error.message,
      data: { total_gb: "0", used_gb: "0", free_gb: "0", path: "" }
    };
  }
});

// --- DOCKER DISK MANAGEMENT ---

ipcMain.handle("docker:reclaim-space", async () => {
  try {
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, "scripts", "compact-wsl.ps1")
      : path.join(__dirname, "scripts", "compact-wsl.ps1");

    return new Promise((resolve) => {
      // Use execFile to avoid CMD shell escaping issues
      const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-DistroName", OPENFORK_WSL_DISTRO];
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
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      ...args
    ];

    // Use PowerShell array literal syntax @('arg1', 'arg2') for -ArgumentList.
    // This is much more robust than a single string with nested quotes.
    const argumentArray = innerArgs
      .map(arg => `'${arg.toString().replace(/'/g, "''")}'`)
      .join(", ");

    const command = `Start-Process powershell -ArgumentList @(${argumentArray}) -Verb RunAs -Wait`;

    console.log(`Requesting elevation for: ${scriptPath}`);
    
    // Use execFile to avoid one layer of CMD/shell parsing
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], (error) => {
      if (error) {
        console.error("Elevation failed or was cancelled:", error.message);
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true });
      }
    });
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
    console.log(`Cleaning up old distribution before relocation to: ${newDrivePath}`);
    const relocateArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", relocateScriptPath, "-DistroName", OPENFORK_WSL_DISTRO, "-NewLocation", newDrivePath];
    
    const relocateResult = await new Promise((resolve) => {
      execFile("powershell.exe", relocateArgs, (error) => {
        if (error) {
          console.error("Relocation wipe failed:", error.message);
          resolve({ success: false, error: `Failed to clean up old distribution: ${error.message}` });
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
      const settings = store.get("appSettings") || {};
      settings.wslStoragePath = newDrivePath;
      store.set("appSettings", settings);
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
    const psCommand = "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{Name='FreeGB';Expression={[math]::Round($_.Free/1GB, 1)}} | ConvertTo-Json";
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
          resolve(drives.map(d => ({
            name: d.Name,
            freeGB: d.FreeGB
          })));
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
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand], (error, stdout) => {
      if (error || !stdout) {
        resolve(null);
        return;
      }
      resolve(stdout.trim());
    });
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
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCommand], (error, stdout) => {
      // Even if there's an error, check the output as it might contain the list anyway
      const output = (stdout || "").replace(/\0/g, "");
      if (output.includes(distroName)) {
        resolve(true);
      } else {
        if (error) {
           console.error(`WSL check failed: ${error.message}. Output: ${output}`);
        }
        resolve(false);
      }
    });
  });
}

ipcMain.handle("deps:check-docker", async () => {
  // Use a separate exec that doesn't log errors (cleaner output)
  const checkCommand = (cmd) => {
    return new Promise((resolve) => {
      if (process.platform === "win32") {
        // Use -- separator for robustness
        const args = ["-d", OPENFORK_WSL_DISTRO, "--user", "root", "--", "bash", "-c", cmd];
        execFile("wsl.exe", args, { timeout: 15000 }, (error, stdout, stderr) => {
          if (error) {
            console.log(`Check command '${cmd}' failed: ${error.message}`);
            console.log(`WSL Stdout: ${stdout}`);
            console.log(`WSL Stderr: ${stderr}`);
            resolve({ success: false, error: error.message });
          } else {
            resolve({ success: true, output: stdout.trim() });
          }
        });
      } else {
        exec(cmd, { timeout: 10000 }, (error, stdout, stderr) => {
          if (error) {
            console.log(`Check command '${cmd}' failed: ${error.message}`);
            console.log(`Stdout: ${stdout}`);
            console.log(`Stderr: ${stderr}`);
            resolve({ success: false, error: error.message });
          } else {
            resolve({ success: true, output: stdout.trim() });
          }
        });
      }
    });
  };

  try {
    // WSL CHECK (Windows only)
    if (process.platform === "win32") {
      const distroExists = await checkDistroExists(OPENFORK_WSL_DISTRO);
      if (!distroExists) {
        console.log("Ubuntu WSL distro missing");
        return { installed: false, running: false, error: "WSL_DISTRO_MISSING" };
      }
    }

    // Get installation path for UI
    const basePath = await getDistroBasePath(OPENFORK_WSL_DISTRO);
    let installDrive = null;
    if (basePath) {
      const match = basePath.match(/([a-zA-Z]):/);
      if (match) installDrive = match[1].toUpperCase();
    }

    // Check if Docker CLI is available
    const versionResult = await checkCommand("docker --version");
    if (!versionResult.success) {
      console.log("Docker CLI not found inside WSL Ubuntu");
      return { installed: false, running: false, installDrive };
    }

      // Check if Docker daemon is running and responsive
      const infoResult = await checkCommand("docker info");
      if (infoResult.success) {
        if (process.platform === "win32") {
          const dockerHost = await resolveWindowsDockerApiEndpoint(15000);
          if (!dockerHost) {
            delete process.env.OPENFORK_DOCKER_HOST;
            return {
              installed: true,
              running: false,
              installDrive,
              error: "DOCKER_API_UNREACHABLE",
            };
          }
          process.env.OPENFORK_DOCKER_HOST = dockerHost;
        }
        return { installed: true, running: true, installDrive };
      } else {
      console.log("Docker is installed but daemon not running:", infoResult.error);
      return { installed: true, running: false, installDrive };
    }
  } catch (err) {
    console.error("Unexpected error checking Docker:", err);
    return { installed: false, running: false };
  }
});

ipcMain.handle("deps:install-engine", async (event, installPath) => {
  console.log(`Starting engine installation on path: ${installPath || "default"}`);
  
  if (process.platform === "darwin") {
    return { success: false, error: "Auto-install not supported on macOS." };
  }
  
  const scriptPath = process.platform === "win32"
    ? (app.isPackaged ? path.join(process.resourcesPath, "bin", "setup-wsl.ps1") : path.join(__dirname, "..", "client", "setup-wsl.ps1"))
    : (app.isPackaged ? path.join(process.resourcesPath, "bin", "setup-linux.sh") : path.join(__dirname, "..", "client", "setup-linux.sh"));

  if (process.platform === "win32") {
    console.log(`Using setup script: ${scriptPath}`);
    const setupArgs = installPath ? ["-InstallPath", installPath] : [];
    const result = await runElevatedPowerShell(scriptPath, setupArgs);
    if (!result.success) {
      console.error("Installation process error:", result.error);
      return { success: false, error: result.error };
    } else {
      console.log("Installation process completed successfully.");
      return { success: true };
    }
  } else {
    // LinuxPKExec handler
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

ipcMain.handle("deps:check-nvidia", async () => {
  try {
    const output = await new Promise((resolve, reject) => {
      exec(
        "nvidia-smi --query-gpu=name --format=csv,noheader",
        { timeout: 10000 },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        }
      );
    });
    return { available: true, gpu: output.toString().trim().split("\n")[0] };
  } catch {
    return { available: false, gpu: null };
  }
});

ipcMain.handle("deps:open-docker-download", () => {
  const urls = {
    win32: "https://www.docker.com/products/docker-desktop/",
    darwin: "https://www.docker.com/products/docker-desktop/",
    linux: "https://docs.docker.com/engine/install/",
  };
  const url = urls[process.platform] || urls.linux;
  shell.openExternal(url);
  return { success: true };
});

// --- UPDATE HANDLERS ---
ipcMain.handle("update:download", () => {
  autoUpdater.downloadUpdate();
});

ipcMain.handle("update:install", () => {
  autoUpdater.quitAndInstall();
});
