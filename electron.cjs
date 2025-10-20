const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const Store = require("electron-store").default;
const { createClient } = require("@supabase/supabase-js");
const { PythonProcessManager } = require("./src/python-process-manager.cjs");

// Single-instance lock (protocol handler)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine) => {
    // Focus existing window if a second instance is opened
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // Handle protocol URL if opened (e.g. openfork-desktop-app://)
    const url = commandLine.pop();
    if (url && url.startsWith("openfork-desktop-app://") && mainWindow) {
      mainWindow.webContents.send("auth:callback", url);
    }
  });
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

// Keep auth session up-to-date and send to renderer
supabase.auth.onAuthStateChange((event, newSession) => {
  console.log(`Supabase auth event: ${event}`);
  session = newSession;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:session", session);
  }
});

// Launch Google login via external URL
async function googleLogin() {
  const syncUrl = `${ORCHESTRATOR_API_URL}/auth/electron-login`;
  console.log(`Opening auth URL: ${syncUrl}`);
  shell.openExternal(syncUrl);
}

// Logout and stop Python backend
async function logout() {
  if (pythonManager) await pythonManager.stop();
  const { error } = await supabase.auth.signOut();
  if (error) console.error("Error logging out:", error.message);
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    backgroundColor: "#111827", // Tailwind bg-gray-900
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      // Enable webSecurity in production for same-origin policy; disable only in dev if necessary
      webSecurity: app.isPackaged,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Load the React app: either dev server or packaged index.html
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "dist/index.html"));
    // Optionally open DevTools in production for debugging:
    mainWindow.webContents.openDevTools();
  } else {
    // Development: load from local Vite/CRA server and open DevTools
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  }

  // After the page loads, send stored session to renderer
  mainWindow.webContents.on("did-finish-load", async () => {
    const { data } = await supabase.auth.getSession();
    session = data.session;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("auth:session", session);
    }
  });

  // Instantiate Python backend manager
  const userDataPath = app.getPath("userData");
  pythonManager = new PythonProcessManager({
    supabase,
    mainWindow,
    userDataPath,
  });

  // Handle window close: stop Python before quitting
  mainWindow.on("close", (event) => {
    if (pythonManager && !pythonManager.isQuitting) {
      event.preventDefault();
      app.quit(); // triggers before-quit where we stop Python
    }
  });

  mainWindow.webContents.on("crashed", async (event, killed) => {
    console.error(`Electron: Renderer crashed. Killed: ${killed}`);
    if (pythonManager) {
      await pythonManager.stop();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Stop Python cleanly before quit
app.on("before-quit", async (event) => {
  if (!pythonManager || pythonManager.isQuitting) return;
  console.log("Electron: before-quit triggered.");
  event.preventDefault();
  pythonManager.isQuitting = true;
  await pythonManager.stop();
  console.log("Electron: Backend stopped. Now quitting.");
  app.quit();
});

// Handle custom protocol (auth redirect)
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleAuthCallback(url);
});

// IPC handlers
ipcMain.handle("auth:google-login", googleLogin);
ipcMain.handle("auth:logout", logout);
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
