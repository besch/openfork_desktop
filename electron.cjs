const { app, BrowserWindow, ipcMain, shell, net } = require("electron");
const path = require("path");

if (app.isPackaged) {
}
const Store = require("electron-store").default;
const { createClient } = require("@supabase/supabase-js");
const { PythonProcessManager } = require("./src/python-process-manager.cjs");
const { ScheduleManager, SCHEDULE_PRESETS } = require("./src/schedule-manager.cjs");
const { autoUpdater } = require("electron-updater");
const process = require("process");

// --- ENABLE BUILT-IN AI (Gemini Nano) ---
// Note: Requires Electron 32+ (Chrome 128+)
// We enable several feature variants to cover all implementations across Chromium versions
app.commandLine.appendSwitch("enable-features", "OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano,PromptAPIGeminiNano,SummarizationAPI,LanguageModelAPI,GeminiNanoAPI,ExperimentalBuiltInAI,ModelExecutionCapability,OnDeviceModelService,WriterAPI,RewriterAPI");
app.commandLine.appendSwitch("enable-blink-features", "PromptAPI,SummarizationAPI,LanguageModelAPI,WriterAPI,RewriterAPI");
app.commandLine.appendSwitch("enable-experimental-web-platform-features");
// Bypass hardware checks and enable debug info
app.commandLine.appendSwitch("optimization-guide-on-device-model-show-debug-info");
app.commandLine.appendSwitch("enable-optimization-guide-on-device-model");
// Force enable even without full download immediately (will trigger download)
app.commandLine.appendSwitch("install-optimization-guide-on-device-model");


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
let convexToken = null; // Convex auth token from website login
let pythonManager;
let scheduleManager;
let isQuittingApp = false; // App-level flag to prevent before-quit race condition

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
  convexToken = null;
  store.delete("convexAuthToken");
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:session", null);
  }
}

function handleAuthCallback(url) {
  console.log("Received auth callback URL:", url);
  
  // Parse the URL to extract tokens
  try {
    const urlObj = new URL(url);
    const hash = urlObj.hash.substring(1); // Remove the #
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    
    if (accessToken) {
      console.log("Received Convex auth token");
      convexToken = accessToken;
      store.set("convexAuthToken", accessToken);
      
      // Create a session-like object for compatibility
      session = {
        access_token: accessToken,
        user: { id: "convex-user" }, // Will be populated when we fetch user info
      };
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("auth:session", session);
        mainWindow.webContents.send("auth:convex-token", accessToken);
      }
      return;
    }
  } catch (e) {
    console.error("Failed to parse auth callback URL:", e);
  }
  
  // Fallback to original behavior for Supabase tokens
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
    // First check for stored Convex token
    const storedConvexToken = store.get("convexAuthToken");
    if (storedConvexToken) {
      console.log("Found stored Convex token");
      convexToken = storedConvexToken;
      session = {
        access_token: storedConvexToken,
        user: { id: "convex-user" },
      };
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("auth:session", session);
        mainWindow.webContents.send("auth:convex-token", storedConvexToken);
      }
      return;
    }
    
    // Fallback to Supabase session
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
  });

  // Instantiate the schedule manager
  scheduleManager = new ScheduleManager({
    pythonManager,
    store,
    mainWindow,
  });
  scheduleManager.loadConfig(); // Load saved schedule on startup

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

ipcMain.on("openfork_client:start", (event, service, policy, allowedIds) => {
  if (pythonManager) pythonManager.start(service, policy, allowedIds);
});
ipcMain.on("openfork_client:stop", () => {
  if (pythonManager) pythonManager.stop();
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

ipcMain.handle("get-convex-token", async () => {
  return convexToken || store.get("convexAuthToken") || null;
});

ipcMain.handle("auth:set-convex-token", async (event, token) => {
  convexToken = token;
  store.set("convexAuthToken", token);
  session = {
    access_token: token,
    user: { id: "convex-user" },
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:session", session);
    mainWindow.webContents.send("auth:convex-token", token);
  }
  return { success: true };
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
const { execSync, exec } = require("child_process");

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
    exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Docker command error: ${error.message}`);
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

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
    await execDockerCommand(`docker rmi -f ${escapeShellArg(imageId)}`);
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

ipcMain.handle("docker:cleanup-all", async () => {
  try {
    // Stop all containers first
    const containerResult = await new Promise((resolve) => {
      ipcMain.emit("docker:stop-all-containers");
      resolve({ success: true });
    });
    
    // Get container IDs
    let stoppedCount = 0;
    try {
      const containerOutput = await execDockerCommand(
        'docker ps -a --format "{{.ID}}" --filter "name=dgn-client"'
      );
      if (containerOutput) {
        const containerIds = containerOutput.split("\n").filter(Boolean);
        for (const id of containerIds) {
          try {
            await execDockerCommand(`docker stop ${id}`);
            await execDockerCommand(`docker rm -f ${id}`);
            stoppedCount++;
          } catch (e) {
            console.warn(`Failed to stop/remove container ${id}:`, e.message);
          }
        }
      }
    } catch (e) {
      console.warn("Error stopping containers:", e.message);
    }
    
    // Remove all openfork images
    let removedCount = 0;
    try {
      const imageOutput = await execDockerCommand(
        'docker images --format "{{.ID}}|{{.Repository}}:{{.Tag}}"'
      );
      if (imageOutput) {
        const lines = imageOutput.split("\n").filter(Boolean);
        for (const line of lines) {
          const [id, fullName] = line.split("|");
          // Only remove images containing "openfork"
          if (fullName && fullName.toLowerCase().includes("openfork")) {
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
      console.warn("Error removing images:", e.message);
    }
    
    return { success: true, stoppedCount, removedCount };
  } catch (error) {
    console.error("Failed to cleanup Docker:", error);
    return { success: false, error: error.message };
  }
});

// Get disk space information
ipcMain.handle("docker:get-disk-space", async () => {
  try {
    let totalBytes, freeBytes, usedBytes, diskPath;
    
    if (process.platform === "win32") {
      // Windows: Use PowerShell to get disk info for C: drive
      const psCommand = "Get-PSDrive C | Select-Object @{Name='Total';Expression={$_.Used+$_.Free}}, Free, Used | ConvertTo-Json";
      
      const output = await new Promise((resolve, reject) => {
        exec(`powershell -NoProfile -NonInteractive -Command "${psCommand}"`, { timeout: 5000 }, (error, stdout, stderr) => {
          if (error) {
            console.error("PowerShell disk space check error:", error.message);
            reject(error);
            return;
          }
          resolve(stdout.trim());
        });
      });
      
      const diskInfo = JSON.parse(output);
      totalBytes = diskInfo.Total;
      freeBytes = diskInfo.Free;
      usedBytes = diskInfo.Used;
      diskPath = "C:\\";
    } else {
      // Linux/macOS: Use df command
      const dfOutput = await new Promise((resolve, reject) => {
        exec("df -k /", { timeout: 5000 }, (error, stdout, stderr) => {
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

// --- DEPENDENCY DETECTION ---

ipcMain.handle("deps:check-docker", async () => {
  // Use a separate exec that doesn't log errors (cleaner output)
  const checkCommand = (cmd) => {
    return new Promise((resolve) => {
      exec(cmd, { timeout: 3000 }, (error, stdout) => {
        if (error) {
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true, output: stdout.trim() });
        }
      });
    });
  };

  try {
    // Check if Docker CLI is available
    const versionResult = await checkCommand("docker --version");
    if (!versionResult.success) {
      console.log("Docker CLI not found");
      return { installed: false, running: false };
    }

    // Check if Docker daemon is running and responsive
    const infoResult = await checkCommand("docker info");
    if (infoResult.success) {
      return { installed: true, running: true };
    } else {
      console.log("Docker is installed but daemon not running:", infoResult.error);
      return { installed: true, running: false };
    }
  } catch (err) {
    console.error("Unexpected error checking Docker:", err);
    return { installed: false, running: false };
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
