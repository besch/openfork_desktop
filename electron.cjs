const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const Store = require("electron-store").default;
const { createClient } = require("@supabase/supabase-js");

// --- PROTOCOL & INITIALIZATION ---

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("dgn-client", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("dgn-client");
}

const store = new Store();
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require("./config.json");
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
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
  }
);

let pythonProcess;
let mainWindow;
let session = null;
let isQuitting = false; // Flag to indicate if the app is in the process of quitting

// --- AUTHENTICATION ---

async function googleLogin() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: "dgn-client://auth/callback",
    },
  });

  if (error) {
    console.error("Error logging in:", error.message);
    mainWindow.webContents.send("auth:error", error.message);
    return;
  }

  if (data.url) {
    shell.openExternal(data.url);
  }
}

async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Error logging out:", error.message);
  }
  session = null;
  mainWindow.webContents.send("auth:session", null);
}

async function initializeSession() {
  const { data } = await supabase.auth.getSession();
  session = data.session;

  if (mainWindow) {
    mainWindow.webContents.on("did-finish-load", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("auth:session", session);
      }
    });
  }
}

function handleAuthCallback(url) {
  if (mainWindow) {
    mainWindow.webContents.send("auth:callback", url);
  }
}

// --- PYTHON BACKEND ---

function getPythonExecutablePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "bin", "dgn_client_backend.exe");
  } else {
    return path.join(__dirname, "bin", "dgn_client_backend.exe");
  }
}

function startPythonBackend() {
  if (pythonProcess) {
    console.log("Python process is already running.");
    return;
  }
  if (!session) {
    console.error("Cannot start DGN client: User not authenticated.");
    mainWindow.webContents.send("dgn-client:log", {
      type: "stderr",
      message: "Authentication required.",
    });
    return;
  }

  const pythonExecutablePath = getPythonExecutablePath();
  const pythonCwd = path.dirname(pythonExecutablePath);
  const args = ["--access-token", session.access_token];

  console.log(`Starting Python backend with token...`);

  try {
    pythonProcess = spawn(pythonExecutablePath, args, {
      cwd: pythonCwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    mainWindow.webContents.send("dgn-client:status", "starting");

    pythonProcess.stdout.on("data", (data) => {
      const log = data.toString();
      if (log.includes("DGN_CLIENT_RUNNING")) {
        mainWindow.webContents.send("dgn-client:status", "running");
        return;
      }
      console.log(`Python stdout: ${log}`);
      mainWindow.webContents.send("dgn-client:log", {
        type: "stdout",
        message: log,
      });
    });

    pythonProcess.stderr.on("data", (data) => {
      const log = data.toString();
      console.error(`Python stderr: ${log}`);
      mainWindow.webContents.send("dgn-client:log", {
        type: "stderr",
        message: log,
      });
    });

    pythonProcess.on("close", (code) => {
      console.log(`Electron: Python process exited with code ${code}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("dgn-client:status", "stopped");
      }
      pythonProcess = null;
    });

    pythonProcess.on("error", (err) => {
      console.error(`Electron: Failed to start Python process: ${err}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("dgn-client:status", "error");
      }
      pythonProcess = null;
    });
  } catch (err) {
    console.error(`Error spawning Python process: ${err}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("dgn-client:status", "error");
    }
  }
}

function stopPythonBackend() {
  return new Promise((resolve) => {
    if (!pythonProcess) {
      console.log("Electron: No Python process running to stop.");
      return resolve();
    }

    console.log("Electron: Attempting to stop Python process...");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("dgn-client:status", "stopping");
    }

    // Listen for the close event on the process
    pythonProcess.once('close', () => {
      console.log("Electron: Python process confirmed closed.");
      pythonProcess = null;
      resolve();
    });

    // Send HTTP shutdown request
    fetch(`http://localhost:8000/shutdown`)
      .catch(error => {
        console.error(`Electron: Error sending HTTP shutdown request: ${error}. Falling back to kill.`);
        if (pythonProcess) pythonProcess.kill();
      });

    // Failsafe timeout
    setTimeout(() => {
      if (pythonProcess) {
        console.warn("Electron: Python process did not exit gracefully, forcing kill.");
        pythonProcess.kill();
      }
    }, 8000); // 8 seconds timeout
  });
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
    if (url.startsWith("dgn-client://")) {
      handleAuthCallback(url);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Intercept the close event
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault(); // Prevent the window from closing
      app.quit(); // Trigger the before-quit event
    }
  });

  mainWindow.webContents.on("crashed", (event, killed) => {
    console.error(`Electron: Renderer process crashed. Killed: ${killed}`);
    // If the renderer crashes, we should probably shut down the backend too
    if (pythonProcess) stopPythonBackend();
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
  } else {
    mainWindow.loadURL("http://localhost:5173");
  }
}

app.whenReady().then(() => {
  createWindow();
  initializeSession();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // This event is now less important as before-quit handles the main logic.
  // On macOS, the app often stays open even if all windows are closed.
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  if (isQuitting) return;

  console.log("Electron: before-quit event triggered.");
  event.preventDefault(); // Prevent the app from quitting immediately
  isQuitting = true;

  await stopPythonBackend();

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
ipcMain.handle("auth:set-session-from-tokens", async (event, accessToken, refreshToken) => {
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
});
ipcMain.on("dgn-client:start", startPythonBackend);
ipcMain.on("dgn-client:stop", stopPythonBackend);
ipcMain.on("window:set-closable", (event, closable) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setClosable(closable);
  }
});
