const { app, BrowserWindow, ipcMain, shell, net } = require("electron");
const path = require("path");

if (app.isPackaged) {
}
const Store = require("electron-store").default;
const { createClient } = require("@supabase/supabase-js");
const { PythonProcessManager } = require("./src/python-process-manager.cjs");
const { autoUpdater } = require("electron-updater");

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
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      devTools: false,
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
  if (!pythonManager || pythonManager.isQuitting) return;

  console.log("Electron: before-quit event triggered.");
  event.preventDefault(); // Prevent the app from quitting immediately
  pythonManager.isQuitting = true;

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

ipcMain.on("window:set-closable", (event, closable) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setClosable(closable);
  }
});

ipcMain.handle("get-orchestrator-api-url", () => ORCHESTRATOR_API_URL);
ipcMain.handle("get-session", async () => {
  return session;
});

// Add persistence handlers for job policy settings
ipcMain.handle("load-settings", async () => {
  try {
    const settings = store.get("appSettings") || {};
    console.log("Loaded settings from store:", settings);
    return settings;
  } catch (error) {
    console.error("Error loading settings:", error);
    return null;
  }
});

ipcMain.handle("save-settings", async (event, settings) => {
  try {
    console.log("Saving settings to store:", settings);
    store.set("appSettings", settings);
    return { success: true };
  } catch (error) {
    console.error("Error saving settings:", error);
    return { success: false, error: error.message };
  }
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
      'docker images --format "{{json .}}" --filter "reference=*openfork*" --filter "reference=*comfyui*" --filter "reference=*diffrhythm*" --filter "reference=*ollama*"'
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
    await execDockerCommand(`docker rmi -f ${imageId}`);
    return { success: true };
  } catch (error) {
    console.error(`Failed to remove Docker image ${imageId}:`, error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("docker:remove-all-images", async () => {
  try {
    // First, get all OpenFork-related images
    const listOutput = await execDockerCommand(
      'docker images --format "{{.ID}}" --filter "reference=*openfork*" --filter "reference=*comfyui*" --filter "reference=*diffrhythm*" --filter "reference=*ollama*"'
    );
    if (!listOutput) return { success: true, removedCount: 0 };
    
    const imageIds = listOutput.split("\n").filter(Boolean);
    for (const id of imageIds) {
      await execDockerCommand(`docker rmi -f ${id}`);
    }
    return { success: true, removedCount: imageIds.length };
  } catch (error) {
    console.error("Failed to remove all Docker images:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("docker:stop-container", async (event, containerId) => {
  try {
    await execDockerCommand(`docker stop ${containerId}`);
    await execDockerCommand(`docker rm -f ${containerId}`);
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
      try {
        await execDockerCommand(`docker stop ${id}`);
        await execDockerCommand(`docker rm -f ${id}`);
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
    
    // Remove all images
    let removedCount = 0;
    try {
      const imageOutput = await execDockerCommand(
        'docker images --format "{{.ID}}" --filter "reference=*openfork*" --filter "reference=*comfyui*" --filter "reference=*diffrhythm*" --filter "reference=*ollama*"'
      );
      if (imageOutput) {
        const imageIds = imageOutput.split("\n").filter(Boolean);
        for (const id of imageIds) {
          try {
            await execDockerCommand(`docker rmi -f ${id}`);
            removedCount++;
          } catch (e) {
            console.warn(`Failed to remove image ${id}:`, e.message);
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
      console.log("Docker is installed and running");
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
