const { app, BrowserWindow, ipcMain, shell, net } = require("electron");
const path = require("path");

if (app.isPackaged) {
}
const Store = require("electron-store").default;
const { createClient } = require("@supabase/supabase-js");
const { PythonProcessManager } = require("./src/python-process-manager.cjs");

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

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
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
