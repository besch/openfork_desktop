const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const Store = require("electron-store").default;
const { createClient } = require("@supabase/supabase-js");

// --- PROTOCOL & INITIALIZATION ---

// Register the custom protocol
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

ipcMain.on("auth:session-update", (event, newSession) => {
  session = newSession;
});

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
  store.delete("refresh_token");
  mainWindow.webContents.send("auth:session", null);
}

async function refreshSession() {
  const refreshToken = store.get("refresh_token");
  if (refreshToken) {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error) {
      console.error("Failed to refresh session:", error.message);
      store.delete("refresh_token"); // Clear invalid token
      session = null;
    } else {
      session = data.session;
      store.set("refresh_token", session.refresh_token);
    }
  } else {
    session = null;
  }

  // Send session to renderer once it's loaded
  if (mainWindow) {
    mainWindow.webContents.on("did-finish-load", () => {
      mainWindow.webContents.send("auth:session", session);
    });
  }
}

function handleAuthCallback(url) {
  // The URL will be like: dgn-client://auth/callback#access_token=...&refresh_token=...
  // Send the full URL to the renderer process to handle
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

    mainWindow.webContents.send("dgn-client:status", "running");

    pythonProcess.stdout.on("data", (data) => {
      const log = data.toString();
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
      console.log(`Python process exited with code ${code}`);
      mainWindow.webContents.send("dgn-client:status", "stopped");
      pythonProcess = null;
    });

    pythonProcess.on("error", (err) => {
      console.error(`Failed to start Python process: ${err}`);
      mainWindow.webContents.send("dgn-client:status", "error");
      pythonProcess = null;
    });
  } catch (err) {
    console.error(`Error spawning Python process: ${err}`);
    mainWindow.webContents.send("dgn-client:status", "error");
  }
}

function stopPythonBackend() {
  if (pythonProcess) {
    console.log("Stopping Python process...");
    mainWindow.webContents.send("dgn-client:status", "stopping");
    pythonProcess.kill();
    pythonProcess = null;
  }
}

// --- APP LIFECYCLE ---

// Ensure only one instance of the app can run
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // Handle the URL from the command line on Windows/Linux
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

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
  } else {
    mainWindow.loadURL("http://localhost:5173"); // Vite dev server URL
  }
}

app.whenReady().then(() => {
  createWindow();
  refreshSession();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopPythonBackend();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Handle the custom protocol URL on macOS
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleAuthCallback(url);
});

// --- IPC HANDLERS ---
ipcMain.handle("auth:google-login", googleLogin);
ipcMain.handle("auth:logout", logout);
ipcMain.on("dgn-client:start", startPythonBackend);
ipcMain.on("dgn-client:stop", stopPythonBackend);
